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
    const { data: action, error } = await context.supabase
      .from("monitor_actions")
      .select("id, monitor_accounts!inner(user_id)")
      .eq("id", data.actionId)
      .maybeSingle();
    if (error || !action) throw new Error("Action not found");
    const { dispatchExternalAction } = await import(
      "@/lib/monitor/external-action-adapter.server"
    );
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
    return runScheduler(settings?.batch_size ?? 10);
  });

export const getMonitorSystemStatusFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => ({
    statusSourceConfigured: Boolean(process.env.RAPIDAPI_KEY),
    cronSecretConfigured: Boolean(process.env.CRON_SECRET),
    actionAdapterConfigured: Boolean(process.env.JAP_API_KEY),
  }));
