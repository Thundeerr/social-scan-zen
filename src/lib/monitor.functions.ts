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

/** Works the caller's own order queue once (dispatch + reconcile). */
export const runActionTickNowFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { runActionTick } = await import("@/lib/monitor/external-action-adapter.server");
    return runActionTick(10, { userId: context.userId });
  });

/**
 * Read-only provider connection test. Asks the provider for the account
 * balance — never places an order, so it is safe to click at any time.
 */
export const testProviderConnectionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: settings } = await context.supabase
      .from("monitor_settings")
      .select("adapter_base_url")
      .eq("user_id", context.userId)
      .maybeSingle();
    const { fetchProviderBalance } = await import(
      "@/lib/monitor/external-action-adapter.server"
    );
    return fetchProviderBalance(settings?.adapter_base_url ?? null);

/**
 * Read-only provider service catalogue, filtered server-side. Never orders.
 */
export const listProviderServicesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { search?: string }) =>
    z.object({ search: z.string().max(80).optional() }).parse(data ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { data: settings } = await context.supabase
      .from("monitor_settings")
      .select("adapter_base_url")
      .eq("user_id", context.userId)
      .maybeSingle();
    const { fetchProviderServices } = await import(
      "@/lib/monitor/external-action-adapter.server"
    );
    return fetchProviderServices(settings?.adapter_base_url ?? null, data.search ?? "");
  });


/** Operational picture of the order path: caps, spend, queue health. */
export const getOrderOpsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { loadOrderPolicy, loadOrderSpend } = await import(
      "@/lib/monitor/action-budget.server"
    );
    const { validateProviderBaseUrl, resolveProviderBaseUrl } = await import(
      "@/lib/monitor/action-guard"
    );
    const policy = await loadOrderPolicy(context.userId);
    const spend = await loadOrderSpend(policy);
    const baseUrl = resolveProviderBaseUrl(policy.baseUrl);
    const endpoint = validateProviderBaseUrl(baseUrl);

    const statuses = ["queued", "processing", "blocked", "failed", "unknown_outcome"] as const;
    const counts: Record<string, number> = {};
    for (const status of statuses) {
      const { count } = await context.supabase
        .from("monitor_actions")
        .select("id", { count: "exact", head: true })
        .eq("status", status);
      counts[status] = count ?? 0;
    }

    return {
      configured: Boolean(process.env.JAP_API_KEY),
      baseUrl,
      endpointAllowed: endpoint.ok,
      endpointReason: endpoint.ok ? null : endpoint.reason,
      ordersPaused: policy.ordersPaused,
      dailyCap: policy.dailyCap,
      monthlyCap: policy.monthlyCap,
      maxQuantityPerAction: policy.maxQuantityPerAction,
      minProviderBalance: policy.minProviderBalance,
      ordersToday: spend.ordersToday,
      ordersThisMonth: spend.ordersThisMonth,
      queue: counts,
    };
  });

/** Pause/resume all outbound orders for the calling operator. */
export const setOrdersPausedFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { paused: boolean }) =>
    z.object({ paused: z.boolean() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("monitor_settings")
      .update({ orders_paused: data.paused })
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { paused: data.paused };
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

