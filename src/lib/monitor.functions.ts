/**
 * Auth-protected RPC surface for the Private→Public monitor UI.
 * Thin wrappers only — all runtime logic lives in ./monitor/*.server.ts.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const checkAccountNowFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { accountId: string }) =>
    z.object({ accountId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: account, error } = await context.supabase
      .from("monitor_accounts")
      .select("*")
      .eq("id", data.accountId)
      .maybeSingle();
    if (error || !account) throw new Error("Account not found");
    const { processAccountSafely } = await import("@/lib/monitor/monitor.server");
    return processAccountSafely(account, { manual: true });
  });

export const triggerManualEventFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { accountId: string }) =>
    z.object({ accountId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: account, error } = await context.supabase
      .from("monitor_accounts")
      .select("*")
      .eq("id", data.accountId)
      .maybeSingle();
    if (error || !account) throw new Error("Account not found");

    // Manual events dispatch paid orders — guard against double clicks and
    // repeated triggering with a server-side minimum gap.
    const MIN_GAP_MINUTES = 5;
    const { data: recent } = await context.supabase
      .from("monitor_events")
      .select("detected_at")
      .eq("account_id", account.id)
      .eq("trigger_type", "manual")
      .order("detected_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (
      recent?.detected_at &&
      Date.now() - new Date(recent.detected_at).getTime() < MIN_GAP_MINUTES * 60_000
    ) {
      throw new Error(
        `A manual event was already triggered for this account less than ${MIN_GAP_MINUTES} minutes ago`,
      );
    }

    const { createEventWithActions, loadSettings } = await import("@/lib/monitor/monitor.server");
    const settings = await loadSettings(account.user_id);
    return createEventWithActions(account, {
      triggerType: "manual",
      transitionKey: `manual:${new Date().toISOString()}`,
      cooldownMinutes: settings.cooldown_minutes,
      suppressed: false,
    });
  });

export const retryActionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { actionId: string }) =>
    z.object({ actionId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    // RLS on monitor_actions scopes SELECT to the caller's own accounts, so a
    // successful read is the ownership check for this action.
    const { data: action, error } = await context.supabase
      .from("monitor_actions")
      .select("id")
      .eq("id", data.actionId)
      .maybeSingle();
    if (error || !action) throw new Error("Action not found");
    const { dispatchExternalAction } = await import("@/lib/monitor/external-action-adapter.server");
    return dispatchExternalAction(data.actionId);
  });

export const runSchedulerNowFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: settings } = await context.supabase
      .from("monitor_settings")
      .select("batch_size")
      .eq("user_id", context.userId)
      .maybeSingle();
    const { runScheduler } = await import("@/lib/monitor/monitor.server");
    // Scope the manual run to the caller's own monitors — never spend another
    // operator's provider quota.
    return runScheduler(settings?.batch_size ?? 10, { userId: context.userId });
  });

export const getMonitorSystemStatusFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => ({
    // Booleans only — never the key material itself.
    statusSourceConfigured: Boolean(process.env.RAPIDAPI_KEY),
    cronSecretConfigured: Boolean(process.env.CRON_SECRET),
    actionAdapterConfigured: Boolean(process.env.JAP_API_KEY),
  }));

/** Shared provider-quota picture used to explain interval costs in the UI. */
export const getMonitorQuotaFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { getQuotaOverview } = await import("@/lib/monitor/quota.server");
    return getQuotaOverview();
  });

/**
 * Authoritative interval change. Enforces the opt-in floor and the shared
 * monthly quota server-side; the UI can only ever mirror this decision.
 */
export const setAccountIntervalFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: { accountId: string; intervalMinutes: number; highFrequencyOptIn: boolean }) =>
      z
        .object({
          accountId: z.string().uuid(),
          intervalMinutes: z.number().int().min(30).max(2880),
          highFrequencyOptIn: z.boolean(),
        })
        .parse(data),
  )
  .handler(async ({ data, context }) => {
    // RLS scopes monitor_accounts to the caller, so a successful read is the
    // ownership check for this account.
    const { data: account, error } = await context.supabase
      .from("monitor_accounts")
      .select("id")
      .eq("id", data.accountId)
      .maybeSingle();
    if (error || !account) throw new Error("Account not found");

    const { applyIntervalChange } = await import("@/lib/monitor/quota.server");
    return applyIntervalChange({
      accountId: data.accountId,
      intervalMinutes: data.intervalMinutes,
      highFrequencyOptIn: data.highFrequencyOptIn,
    });
  });

