/**
 * THE single provider boundary for outbound monitor actions.
 *
 * Nothing else in the codebase may talk to an order provider. Everything —
 * buttons, queue processing, DB records, UI states — hangs off
 * `dispatchExternalAction(actionId)`.
 *
 * Portability contract: swapping providers means editing only this file.
 *
 * Safety model (protects against human error, not against the operator):
 *  - endpoint allowlist + target validation before anything is sent
 *  - pause switch and daily/monthly order caps
 *  - provider balance floor
 *  - single-flight claim, idempotency on provider_reference
 *  - transient failures retried with backoff; provider errors never retried
 *  - unclear outcomes reconciled against the provider's own order status
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  STALE_PROCESSING_MINUTES,
  isRetryExhausted,
  nextAttemptAt,
  resolveProviderBaseUrl,
  validateProviderBaseUrl,
  validateQuantity,
  validateTarget,
} from "./action-guard";
import { checkSpendAllowed, loadOrderPolicy, type OrderPolicy } from "./action-budget.server";

const TIMEOUT_MS = 30_000;

export type ExternalActionStatus =
  | "not_configured"
  | "blocked"
  | "completed"
  | "failed"
  | "unknown_outcome";

export type ExternalActionResult = {
  ok: boolean;
  status: ExternalActionStatus | "skipped" | "queued";
  message?: string;
  providerReference?: string | null;
};

export type ExternalActionRequest = {
  actionId: string;
  accountId: string;
  eventId: string;
  templateId: string;
  target: string;
  quantity: number | null;
  serviceReference: string | null;
  baseUrl: string;
  attempt: number;
  requestedAt: string;
};

function excerpt(value: unknown) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return { raw: String(value).slice(0, 1000) };
  }
}

async function providerCall(
  baseUrl: string,
  params: Record<string, string>,
): Promise<{ ok: boolean; status: number; text: string }> {
  const apiKey = process.env.JAP_API_KEY;
  if (!apiKey) throw new MissingProviderKeyError();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ key: apiKey, ...params }).toString(),
      signal: controller.signal,
    });
    return { ok: res.ok, status: res.status, text: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

export class MissingProviderKeyError extends Error {
  constructor() {
    super("Order provider API key is not configured");
    this.name = "MissingProviderKeyError";
  }
}

/** Read-only balance probe. Never places an order — safe as a connection test. */
export async function fetchProviderBalance(
  rawBaseUrl?: string | null,
): Promise<{ ok: boolean; balance: number | null; currency: string | null; error?: string }> {
  const baseUrl = resolveProviderBaseUrl(rawBaseUrl);
  const allowed = validateProviderBaseUrl(baseUrl);
  if (!allowed.ok) return { ok: false, balance: null, currency: null, error: allowed.reason };
  try {
    const res = await providerCall(baseUrl, { action: "balance" });
    const payload = JSON.parse(res.text) as Record<string, unknown>;
    if (payload.error) {
      return { ok: false, balance: null, currency: null, error: String(payload.error) };
    }
    const balance = Number(payload.balance);
    return {
      ok: Number.isFinite(balance),
      balance: Number.isFinite(balance) ? balance : null,
      currency: payload.currency ? String(payload.currency) : null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, balance: null, currency: null, error: message };
  }
}

// ---------- Dispatch ---------------------------------------------------------

export async function dispatchExternalAction(actionId: string): Promise<ExternalActionResult> {
  const db = supabaseAdmin;

  const { data: action, error } = await db
    .from("monitor_actions")
    .select("*")
    .eq("id", actionId)
    .maybeSingle();

  if (error || !action) {
    return { ok: false, status: "failed", message: "action not found" };
  }

  // Idempotency: an order that already reached the provider is never re-sent.
  if (action.provider_reference) {
    return {
      ok: action.status === "completed",
      status: "skipped",
      message: "Order already placed with the provider",
      providerReference: action.provider_reference,
    };
  }

  const { data: account } = await db
    .from("monitor_accounts")
    .select("user_id, username")
    .eq("id", action.account_id)
    .maybeSingle();

  if (!account) {
    return { ok: false, status: "failed", message: "monitored account not found" };
  }

  const policy = await loadOrderPolicy(account.user_id);
  const baseUrl = resolveProviderBaseUrl(policy.baseUrl);

  async function block(reason: string): Promise<ExternalActionResult> {
    await db
      .from("monitor_actions")
      .update({ status: "blocked", blocked_reason: reason, error_message: reason })
      .eq("id", actionId);
    return { ok: false, status: "blocked", message: reason };
  }

  // --- pre-flight guards, cheapest first --------------------------------
  const endpoint = validateProviderBaseUrl(baseUrl);
  if (!endpoint.ok) return block(endpoint.reason);

  const target = validateTarget(action.target, account.username);
  if (!target.ok) return block(target.reason);

  if (!action.service_reference) {
    return block("Template is missing a service reference");
  }

  const quantityCheck = validateQuantity(action.quantity, policy.maxQuantityPerAction);
  if (!quantityCheck.ok) return block(quantityCheck.reason);

  if (!process.env.JAP_API_KEY) {
    await db
      .from("monitor_actions")
      .update({
        status: "not_configured",
        error_message: "Order provider API key is not configured",
      })
      .eq("id", actionId);
    return { ok: false, status: "not_configured", message: "Order provider is not configured" };
  }

  const { verdict } = await checkSpendAllowed(policy);
  if (!verdict.ok) return block(verdict.reason);

  const balanceGuard = await guardBalance(policy, baseUrl);
  if (balanceGuard) return block(balanceGuard);

  // --- single-flight claim ----------------------------------------------
  const { data: claimed } = await db
    .from("monitor_actions")
    .update({
      status: "processing",
      attempt_count: action.attempt_count + 1,
      blocked_reason: null,
    })
    .eq("id", actionId)
    .eq("attempt_count", action.attempt_count)
    .in("status", ["queued", "failed", "not_configured", "unknown_outcome", "blocked"])
    .select("*")
    .maybeSingle();

  if (!claimed) {
    return { ok: false, status: "skipped", message: "action already in flight" };
  }

  const request: ExternalActionRequest = {
    actionId: claimed.id,
    accountId: claimed.account_id,
    eventId: claimed.event_id,
    templateId: claimed.template_id,
    target: claimed.target,
    quantity: claimed.quantity,
    serviceReference: claimed.service_reference,
    baseUrl,
    attempt: claimed.attempt_count,
    requestedAt: new Date().toISOString(),
  };

  async function finish(
    status: ExternalActionStatus | "queued",
    message?: string,
    providerReference?: string | null,
    responseExcerpt?: unknown,
    extra: Record<string, unknown> = {},
  ): Promise<ExternalActionResult> {
    await db
      .from("monitor_actions")
      .update({
        status,
        error_message: message ?? null,
        provider_reference: status === "completed" ? (providerReference ?? null) : null,
        request_excerpt: excerpt({ ...request, apiKey: undefined }),
        response_excerpt: responseExcerpt === undefined ? null : excerpt(responseExcerpt),
        dispatched_at:
          status === "completed" || status === "unknown_outcome"
            ? new Date().toISOString()
            : (claimed?.dispatched_at ?? null),
        ...extra,
      })
      .eq("id", actionId);
    return {
      ok: status === "completed",
      status,
      message,
      providerReference: providerReference ?? null,
    };
  }

  let res: { ok: boolean; status: number; text: string };
  try {
    res = await providerCall(baseUrl, {
      action: "add",
      service: String(request.serviceReference),
      link: request.target,
      quantity: String(request.quantity),
    });
  } catch (err) {
    // The order may well exist on the provider side — never auto-complete and
    // never auto-fail a network error. Retry with backoff while attempts last.
    const message = err instanceof Error ? err.message : String(err);
    const retryAt = isRetryExhausted(request.attempt) ? null : nextAttemptAt(request.attempt);
    if (retryAt) {
      return finish("queued", `Network error, retrying: ${message}`, null, undefined, {
        next_attempt_at: retryAt,
      });
    }
    return finish("unknown_outcome", `Network error: ${message}`, null, undefined, {
      next_attempt_at: null,
    });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(res.text) as Record<string, unknown>;
  } catch {
    return finish(
      res.ok ? "unknown_outcome" : "failed",
      `Unparsable provider response (HTTP ${res.status})`,
      null,
      { raw: res.text.slice(0, 1000) },
    );
  }

  if (payload.error) {
    // A provider-side rejection is deterministic — never retried.
    return finish("failed", String(payload.error), null, payload, { next_attempt_at: null });
  }

  const order = payload.order;
  if (order === undefined || order === null || String(order).trim() === "") {
    return finish(
      res.ok ? "unknown_outcome" : "failed",
      `Provider response contained no order id (HTTP ${res.status})`,
      null,
      payload,
    );
  }

  return finish("completed", undefined, String(order), payload, { next_attempt_at: null });
}

async function guardBalance(policy: OrderPolicy, baseUrl: string): Promise<string | null> {
  if (!(policy.minProviderBalance > 0)) return null;
  const balance = await fetchProviderBalance(baseUrl);
  if (!balance.ok || balance.balance === null) return null; // never block on a probe failure
  if (balance.balance < policy.minProviderBalance) {
    return `Provider balance ${balance.balance} is below the configured floor of ${policy.minProviderBalance}`;
  }
  return null;
}

// ---------- Order tick: dispatch + reconcile ---------------------------------

export type ActionTickSummary = {
  dispatched: number;
  completed: number;
  blocked: number;
  failed: number;
  reconciled: number;
  released: number;
};

/** Frees actions whose dispatch crashed mid-flight. */
export async function releaseStaleProcessing(): Promise<number> {
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MINUTES * 60_000).toISOString();
  const { data } = await supabaseAdmin
    .from("monitor_actions")
    .update({
      status: "unknown_outcome",
      error_message: "Dispatch interrupted — outcome unknown, awaiting reconciliation",
    })
    .eq("status", "processing")
    .lt("updated_at", staleBefore)
    .select("id");
  return (data ?? []).length;
}

/**
 * Resolves `unknown_outcome` rows against the provider's own order status so
 * they never turn into a silent double order.
 */
export async function reconcileOpenActions(limit = 20): Promise<number> {
  const db = supabaseAdmin;
  const { data: open } = await db
    .from("monitor_actions")
    .select("id, account_id, provider_reference")
    .eq("status", "unknown_outcome")
    .not("provider_reference", "is", null)
    .limit(limit);

  let reconciled = 0;
  for (const row of open ?? []) {
    const { data: account } = await db
      .from("monitor_accounts")
      .select("user_id")
      .eq("id", row.account_id)
      .maybeSingle();
    if (!account) continue;
    const policy = await loadOrderPolicy(account.user_id);
    const baseUrl = resolveProviderBaseUrl(policy.baseUrl);
    if (!validateProviderBaseUrl(baseUrl).ok) continue;

    try {
      const res = await providerCall(baseUrl, {
        action: "status",
        order: String(row.provider_reference),
      });
      const payload = JSON.parse(res.text) as Record<string, unknown>;
      const providerStatus = payload.status ? String(payload.status) : null;
      if (payload.error) {
        await db
          .from("monitor_actions")
          .update({
            status: "failed",
            error_message: String(payload.error),
            provider_status_checked_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        reconciled += 1;
        continue;
      }
      if (providerStatus) {
        const canceled = /cancel|refund/i.test(providerStatus);
        await db
          .from("monitor_actions")
          .update({
            status: canceled ? "failed" : "completed",
            provider_status: providerStatus,
            provider_status_checked_at: new Date().toISOString(),
            error_message: canceled ? `Provider reported "${providerStatus}"` : null,
          })
          .eq("id", row.id);
        reconciled += 1;
      }
    } catch {
      // leave it open; the next tick tries again
    }
  }
  return reconciled;
}

/**
 * Works the order queue. Dispatch is deliberately decoupled from the status
 * scheduler so a slow provider can never delay Instagram status checks.
 */
export async function runActionTick(limit = 10): Promise<ActionTickSummary> {
  const db = supabaseAdmin;
  const released = await releaseStaleProcessing();
  const nowIso = new Date().toISOString();

  const { data: due } = await db
    .from("monitor_actions")
    .select("id")
    .eq("status", "queued")
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
    .order("created_at", { ascending: true })
    .limit(limit);

  const summary: ActionTickSummary = {
    dispatched: 0,
    completed: 0,
    blocked: 0,
    failed: 0,
    reconciled: 0,
    released,
  };

  for (const row of due ?? []) {
    const result = await dispatchExternalAction(row.id);
    summary.dispatched += 1;
    if (result.status === "completed") summary.completed += 1;
    else if (result.status === "blocked") summary.blocked += 1;
    else if (result.status === "failed") summary.failed += 1;
  }

  summary.reconciled = await reconcileOpenActions();
  return summary;
}

export function isActionAdapterConfigured(): boolean {
  return Boolean(process.env.JAP_API_KEY);
}
