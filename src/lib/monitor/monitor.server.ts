/**
 * Monitor pipeline (server-only).
 *
 * check → transition detection → deduplicated event → claimed actions →
 * dispatchExternalAction. All writes run through the service-role client;
 * ownership is verified by callers before entering this module.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { fetchProfileStatus, MissingApiKeyError } from "./instagram.server";
import { dispatchExternalAction } from "./external-action-adapter.server";
import { renderTarget } from "./usernames";
import {
  buildTransitionKey,
  isCooldownActive,
  isPrivateToPublic,
  nextCheckAt,
  resolveIntervalMinutes,
  retryAt,
} from "./transition";

export type MonitorAccount = Database["public"]["Tables"]["monitor_accounts"]["Row"];
export type MonitorSettings = Database["public"]["Tables"]["monitor_settings"]["Row"];

export type ProcessResult = {
  ok: boolean;
  result: "private" | "public" | "error" | "paused";
  eventCreated: boolean;
  cooldownSuppressed: boolean;
  actionsCreated: number;
  error?: string;
};

export async function loadSettings(userId: string): Promise<MonitorSettings> {
  const db = supabaseAdmin;
  const { data } = await db
    .from("monitor_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (data) return data;
  const { data: created, error } = await db
    .from("monitor_settings")
    .insert({ user_id: userId })
    .select("*")
    .single();
  if (error || !created) throw new Error(error?.message ?? "could not create monitor settings");
  return created;
}

async function releaseClaim(accountId: string, patch: Record<string, unknown> = {}) {
  await supabaseAdmin
    .from("monitor_accounts")
    .update({ processing_started_at: null, ...patch })
    .eq("id", accountId);
}

export const STALE_CLAIM_MINUTES = 15;

/**
 * Compare-and-swap claim so a manual check can never run concurrently with the
 * scheduler (or with a second manual click) for the same account.
 */
export async function claimAccount(accountId: string): Promise<boolean> {
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MINUTES * 60_000).toISOString();
  const { data } = await supabaseAdmin
    .from("monitor_accounts")
    .update({ processing_started_at: new Date().toISOString() })
    .eq("id", accountId)
    .or(`processing_started_at.is.null,processing_started_at.lt.${staleBefore}`)
    .select("id")
    .maybeSingle();
  return Boolean(data);
}

export async function createActionsForEvent(
  account: MonitorAccount,
  eventId: string,
): Promise<number> {
  const db = supabaseAdmin;
  const { data: templates } = await db
    .from("monitor_action_templates")
    .select("*")
    .eq("account_id", account.id)
    .eq("enabled", true)
    .order("position", { ascending: true });

  if (!templates || templates.length === 0) return 0;

  const rows = templates.map((t) => ({
    event_id: eventId,
    template_id: t.id,
    account_id: account.id,
    target: renderTarget(t.target_template, account.username),
    quantity: t.quantity,
    service_reference: t.service_reference,
    status: "queued" as const,
  }));

  const { data: inserted } = await db
    .from("monitor_actions")
    .upsert(rows, { onConflict: "event_id,template_id", ignoreDuplicates: true })
    .select("id, template_id");

  const created = inserted ?? [];
  for (const action of created) {
    const template = templates.find((t) => t.id === action.template_id);
    if (template?.dry_run) {
      await db
        .from("monitor_actions")
        .update({
          status: "not_configured",
          error_message: "Dry-run template — no order dispatched",
        })
        .eq("id", action.id);
      continue;
    }
    await dispatchExternalAction(action.id);
  }
  return created.length;
}

export async function createEventWithActions(
  account: MonitorAccount,
  opts: {
    triggerType: "automatic" | "manual";
    transitionKey: string;
    cooldownMinutes: number;
    suppressed: boolean;
    detectedAt?: string;
  },
): Promise<{ eventCreated: boolean; actionsCreated: number; eventId: string | null }> {
  const db = supabaseAdmin;
  const detectedAt = opts.detectedAt ?? new Date().toISOString();

  const { data: event } = await db
    .from("monitor_events")
    .insert({
      account_id: account.id,
      user_id: account.user_id,

      trigger_type: opts.triggerType,
      transition_key: opts.transitionKey,
      detected_at: detectedAt,
      cooldown_minutes: opts.cooldownMinutes,
      cooldown_suppressed: opts.suppressed,
      status: opts.suppressed ? "suppressed" : "created",
    })
    .select("id")
    .maybeSingle();

  if (!event) return { eventCreated: false, actionsCreated: 0, eventId: null };
  if (opts.suppressed) return { eventCreated: true, actionsCreated: 0, eventId: event.id };

  await db.from("monitor_accounts").update({ last_event_at: detectedAt }).eq("id", account.id);
  const actionsCreated = await createActionsForEvent(account, event.id);
  return { eventCreated: true, actionsCreated, eventId: event.id };
}

export async function processAccount(
  account: MonitorAccount,
  opts: { manual?: boolean } = {},
): Promise<ProcessResult> {
  const db = supabaseAdmin;
  const settings = await loadSettings(account.user_id);
  const now = new Date();

  if (!opts.manual && !settings.automation_enabled) {
    await releaseClaim(account.id, { next_check_at: retryAt(now) });
    return {
      ok: true,
      result: "paused",
      eventCreated: false,
      cooldownSuppressed: false,
      actionsCreated: 0,
    };
  }

  const status = await fetchProfileStatus(account.normalized_username);

  if (!status.ok) {
    await db.from("monitor_checks").insert({
      account_id: account.id,
      result: "error",
      previous_is_private: account.is_private,
      current_is_private: null,
      response_excerpt: status.excerpt,
      error_message: status.error,
    });
    // Never overwrite a known status with an error.
    await releaseClaim(account.id, {
      last_error: status.error,
      last_failed_check_at: now.toISOString(),
      next_check_at: retryAt(now),
    });

    return {
      ok: false,
      result: "error",
      eventCreated: false,
      cooldownSuppressed: false,
      actionsCreated: 0,
      error: status.error,
    };
  }

  const previous = {
    status_initialized: account.status_initialized,
    is_private: account.is_private,
    last_checked_at: account.last_checked_at,
  };

  await db.from("monitor_checks").insert({
    account_id: account.id,
    result: status.isPrivate ? "private" : "public",
    previous_is_private: account.is_private,
    current_is_private: status.isPrivate,
    response_excerpt: status.excerpt,
  });

  const transition = isPrivateToPublic(previous, status.isPrivate);
  const transitionKey = buildTransitionKey(previous);

  const interval = resolveIntervalMinutes(
    account.interval_minutes,
    settings.default_interval_minutes,
  );
  await releaseClaim(account.id, {
    is_private: status.isPrivate,
    status_initialized: true,
    last_checked_at: now.toISOString(),
    next_check_at: nextCheckAt(interval, now),
    last_error: null,
  });

  if (!transition) {
    return {
      ok: true,
      result: status.isPrivate ? "private" : "public",
      eventCreated: false,
      cooldownSuppressed: false,
      actionsCreated: 0,
    };
  }

  const suppressed = isCooldownActive(account.last_event_at, settings.cooldown_minutes, now);
  const outcome = await createEventWithActions(account, {
    triggerType: "automatic",
    transitionKey,
    cooldownMinutes: settings.cooldown_minutes,
    suppressed,
    detectedAt: now.toISOString(),
  });

  return {
    ok: true,
    result: "public",
    eventCreated: outcome.eventCreated,
    cooldownSuppressed: suppressed,
    actionsCreated: outcome.actionsCreated,
  };
}

export async function processAccountSafely(
  account: MonitorAccount,
  opts: { manual?: boolean; alreadyClaimed?: boolean } = {},
): Promise<ProcessResult> {
  if (!opts.alreadyClaimed) {
    const claimed = await claimAccount(account.id);
    if (!claimed) {
      return {
        ok: false,
        result: "error",
        eventCreated: false,
        cooldownSuppressed: false,
        actionsCreated: 0,
        error: "A check for this account is already running",
      };
    }
  }
  try {
    return await processAccount(account, opts);
  } catch (err) {
    const message =
      err instanceof MissingApiKeyError
        ? "Profile status provider is not configured"
        : err instanceof Error
          ? err.message
          : String(err);
    await supabaseAdmin.from("monitor_checks").insert({
      account_id: account.id,
      result: "error",
      previous_is_private: account.is_private,
      error_message: message,
    });
    await supabaseAdmin
      .from("monitor_accounts")
      .update({ last_error: message, next_check_at: retryAt() })
      .eq("id", account.id);
    return {
      ok: false,
      result: "error",
      eventCreated: false,
      cooldownSuppressed: false,
      actionsCreated: 0,
      error: message,
    };
  } finally {
    await releaseClaim(account.id);
  }
}

export type SchedulerSummary = {
  runId: string | null;
  checkedAccounts: number;
  createdEvents: number;
  createdActions: number;
  errors: number;
  status: string;
};

export async function runScheduler(
  batchLimit = 10,
  opts: { userId?: string } = {},
): Promise<SchedulerSummary> {
  const db = supabaseAdmin;
  const { data: run } = await db
    .from("monitor_scheduler_runs")
    .insert({ status: "running" })
    .select("id")
    .maybeSingle();

  let checked = 0;
  let events = 0;
  let actions = 0;
  let errors = 0;
  let status = "completed";

  try {
    let due: MonitorAccount[] = [];

    if (opts.userId) {
      // Operator-scoped run: never touch another tenant's accounts or quota.
      const { data: candidates, error } = await db
        .from("monitor_accounts")
        .select("*")
        .eq("user_id", opts.userId)
        .eq("enabled", true)
        .lte("next_check_at", new Date().toISOString())
        .order("next_check_at", { ascending: true })
        .limit(batchLimit);
      if (error) throw new Error(error.message);
      for (const account of candidates ?? []) {
        if (await claimAccount(account.id)) due.push(account);
      }
    } else {
      const { data: claimed, error } = await db.rpc("claim_due_monitor_accounts", {
        _limit: batchLimit,
        _stale_after_minutes: STALE_CLAIM_MINUTES,
      });
      if (error) throw new Error(error.message);
      due = (claimed ?? []) as MonitorAccount[];
    }

    for (const account of due) {
      const result = await processAccountSafely(account, { alreadyClaimed: true });
      checked += 1;
      if (result.eventCreated) events += 1;
      actions += result.actionsCreated;
      if (!result.ok) errors += 1;
    }
    if (errors > 0) status = "completed_with_errors";
  } catch (err) {
    status = "failed";
    errors += 1;
    console.error("[monitor] scheduler failed", err);
  }

  if (run) {
    await db
      .from("monitor_scheduler_runs")
      .update({
        completed_at: new Date().toISOString(),
        checked_accounts: checked,
        created_events: events,
        created_actions: actions,
        errors,
        status,
      })
      .eq("id", run.id);
  }

  return {
    runId: run?.id ?? null,
    checkedAccounts: checked,
    createdEvents: events,
    createdActions: actions,
    errors,
    status,
  };
}
