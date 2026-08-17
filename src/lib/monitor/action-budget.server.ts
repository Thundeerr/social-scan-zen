/**
 * Spend guardrails for outbound provider orders (server-only).
 *
 * Counts are workspace-operator scoped: an operator's caps apply to the
 * orders created for their own monitored accounts. No provider details live
 * here — this module only answers "may we spend right now?".
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { evaluateSpend, type GuardVerdict, type SpendState } from "./action-guard";

export type OrderPolicy = {
  userId: string;
  ordersPaused: boolean;
  dailyCap: number;
  monthlyCap: number;
  maxQuantityPerAction: number;
  minProviderBalance: number;
  baseUrl: string | null;
};

const FALLBACK_POLICY = {
  ordersPaused: false,
  dailyCap: 50,
  monthlyCap: 500,
  maxQuantityPerAction: 10_000,
  minProviderBalance: 0,
  baseUrl: null as string | null,
};

export async function loadOrderPolicy(userId: string): Promise<OrderPolicy> {
  const { data } = await supabaseAdmin
    .from("monitor_settings")
    .select(
      "orders_paused, daily_action_cap, monthly_action_cap, max_quantity_per_action, min_provider_balance, adapter_base_url",
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) return { userId, ...FALLBACK_POLICY };
  return {
    userId,
    ordersPaused: data.orders_paused ?? FALLBACK_POLICY.ordersPaused,
    dailyCap: data.daily_action_cap ?? FALLBACK_POLICY.dailyCap,
    monthlyCap: data.monthly_action_cap ?? FALLBACK_POLICY.monthlyCap,
    maxQuantityPerAction: data.max_quantity_per_action ?? FALLBACK_POLICY.maxQuantityPerAction,
    minProviderBalance: Number(data.min_provider_balance ?? FALLBACK_POLICY.minProviderBalance),
    baseUrl: data.adapter_base_url ?? null,
  };
}

async function accountIdsFor(userId: string): Promise<string[]> {
  const { data } = await supabaseAdmin.from("monitor_accounts").select("id").eq("user_id", userId);
  return (data ?? []).map((r) => r.id);
}

function startOfUtcDay(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

function startOfUtcMonth(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export type OrderSpend = SpendState & { accountIds: string[] };

/** Dispatched orders (money actually spent) for this operator. */
export async function loadOrderSpend(policy: OrderPolicy): Promise<OrderSpend> {
  const accountIds = await accountIdsFor(policy.userId);
  if (accountIds.length === 0) {
    return {
      accountIds,
      ordersToday: 0,
      ordersThisMonth: 0,
      dailyCap: policy.dailyCap,
      monthlyCap: policy.monthlyCap,
    };
  }

  const [today, month] = await Promise.all([
    supabaseAdmin
      .from("monitor_actions")
      .select("id", { count: "exact", head: true })
      .in("account_id", accountIds)
      .gte("dispatched_at", startOfUtcDay()),
    supabaseAdmin
      .from("monitor_actions")
      .select("id", { count: "exact", head: true })
      .in("account_id", accountIds)
      .gte("dispatched_at", startOfUtcMonth()),
  ]);

  return {
    accountIds,
    ordersToday: today.count ?? 0,
    ordersThisMonth: month.count ?? 0,
    dailyCap: policy.dailyCap,
    monthlyCap: policy.monthlyCap,
  };
}

/** Full pre-dispatch decision: pause switch first, then spend caps. */
export async function checkSpendAllowed(
  policy: OrderPolicy,
): Promise<{ verdict: GuardVerdict; spend: OrderSpend }> {
  const spend = await loadOrderSpend(policy);
  if (policy.ordersPaused) {
    return { verdict: { ok: false, reason: "Orders are paused for this operator" }, spend };
  }
  return { verdict: evaluateSpend(spend), spend };
}
