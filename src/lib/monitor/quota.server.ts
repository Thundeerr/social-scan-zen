/**
 * Server-side provider-quota guard for the monitor.
 *
 * The provider quota is a single shared workspace pool, so projections are
 * computed across every operator's monitors (aggregate numbers only — never
 * another tenant's usernames). Callers must have verified ownership of the
 * account they are changing.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  HIGH_FREQUENCY_MIN_INTERVAL_MINUTES,
  MAX_INTERVAL_MINUTES,
  STANDARD_MIN_INTERVAL_MINUTES,
  estimateMonthlyRequests,
  estimateWorkspaceMonthlyRequests,
  evaluateQuota,
  minIntervalFor,
  type QuotaAccount,
  type QuotaVerdict,
} from "./quota";

const DEFAULT_MONTHLY_CAP = 15_000;

function startOfMonth(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

async function loadCap(): Promise<number> {
  const { data } = await supabaseAdmin
    .from("provider_budget")
    .select("monthly_cap")
    .maybeSingle();
  return data?.monthly_cap ?? DEFAULT_MONTHLY_CAP;
}

/** Requests already spent this month, across every provider-touching source. */
async function loadUsedThisMonth(): Promise<number> {
  const since = startOfMonth();
  const [checks, scans] = await Promise.all([
    supabaseAdmin
      .from("monitor_checks")
      .select("id", { count: "exact", head: true })
      .gte("checked_at", since),
    supabaseAdmin
      .from("scanner_runs")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since),
  ]);
  return (checks.count ?? 0) + (scans.count ?? 0);
}

async function loadWorkspaceAccounts(): Promise<
  { id: string; user_id: string; enabled: boolean; interval_minutes: number | null }[]
> {
  const { data } = await supabaseAdmin
    .from("monitor_accounts")
    .select("id, user_id, enabled, interval_minutes");
  return data ?? [];
}

async function loadDefaultIntervals(): Promise<Map<string, number>> {
  const { data } = await supabaseAdmin
    .from("monitor_settings")
    .select("user_id, default_interval_minutes");
  return new Map((data ?? []).map((r) => [r.user_id, r.default_interval_minutes]));
}

function toQuotaAccounts(
  accounts: { id: string; user_id: string; enabled: boolean; interval_minutes: number | null }[],
  defaults: Map<string, number>,
): QuotaAccount[] {
  return accounts.map((a) => ({
    id: a.id,
    enabled: a.enabled,
    intervalMinutes:
      a.interval_minutes ?? defaults.get(a.user_id) ?? STANDARD_MIN_INTERVAL_MINUTES,
  }));
}

export type QuotaOverview = QuotaVerdict & {
  standardMinInterval: number;
  highFrequencyMinInterval: number;
  maxInterval: number;
  /** Cost of a single profile per month at each selectable interval. */
  perProfile: { intervalMinutes: number; monthlyRequests: number }[];
  monitoredProfiles: number;
};

export async function getQuotaOverview(): Promise<QuotaOverview> {
  const [cap, used, accounts, defaults] = await Promise.all([
    loadCap(),
    loadUsedThisMonth(),
    loadWorkspaceAccounts(),
    loadDefaultIntervals(),
  ]);
  const quotaAccounts = toQuotaAccounts(accounts, defaults);
  const projected = estimateWorkspaceMonthlyRequests(quotaAccounts, STANDARD_MIN_INTERVAL_MINUTES);

  return {
    ...evaluateQuota({ projected, used, cap }),
    standardMinInterval: STANDARD_MIN_INTERVAL_MINUTES,
    highFrequencyMinInterval: HIGH_FREQUENCY_MIN_INTERVAL_MINUTES,
    maxInterval: MAX_INTERVAL_MINUTES,
    perProfile: [30, 60, 180, 360, 720, 1440].map((intervalMinutes) => ({
      intervalMinutes,
      monthlyRequests: estimateMonthlyRequests(intervalMinutes),
    })),
    monitoredProfiles: quotaAccounts.filter((a) => a.enabled).length,
  };
}

export type IntervalChange = {
  accountId: string;
  intervalMinutes: number;
  highFrequencyOptIn: boolean;
};

export type IntervalChangeResult = {
  ok: boolean;
  reason?: string;
  quota: QuotaVerdict;
  intervalMinutes: number;
  monthlyRequestsForProfile: number;
};

/**
 * Validates a requested interval against (a) the opt-in floor and (b) the
 * shared monthly provider quota, then persists it. This is the authoritative
 * check — the UI mirrors it, the database CHECK constraint backstops it.
 */
export async function applyIntervalChange(change: IntervalChange): Promise<IntervalChangeResult> {
  const floor = minIntervalFor(change.highFrequencyOptIn);
  const [cap, used, accounts, defaults] = await Promise.all([
    loadCap(),
    loadUsedThisMonth(),
    loadWorkspaceAccounts(),
    loadDefaultIntervals(),
  ]);

  const current = accounts.find((a) => a.id === change.accountId);
  if (!current) {
    return {
      ok: false,
      reason: "Account not found",
      quota: evaluateQuota({ projected: 0, used, cap }),
      intervalMinutes: change.intervalMinutes,
      monthlyRequestsForProfile: 0,
    };
  }

  const monthlyRequestsForProfile = estimateMonthlyRequests(change.intervalMinutes);

  if (!Number.isFinite(change.intervalMinutes) || change.intervalMinutes > MAX_INTERVAL_MINUTES) {
    return {
      ok: false,
      reason: `Interval must be at most ${MAX_INTERVAL_MINUTES} minutes`,
      quota: evaluateQuota({ projected: 0, used, cap }),
      intervalMinutes: change.intervalMinutes,
      monthlyRequestsForProfile,
    };
  }

  if (change.intervalMinutes < floor) {
    return {
      ok: false,
      reason: change.highFrequencyOptIn
        ? `The absolute minimum interval is ${HIGH_FREQUENCY_MIN_INTERVAL_MINUTES} minutes`
        : `Intervals below ${STANDARD_MIN_INTERVAL_MINUTES} minutes require the high-frequency opt-in`,
      quota: evaluateQuota({ projected: 0, used, cap }),
      intervalMinutes: change.intervalMinutes,
      monthlyRequestsForProfile,
    };
  }

  // Project the workspace load with this change applied.
  const projectedAccounts = toQuotaAccounts(accounts, defaults).map((a) =>
    a.id === change.accountId ? { ...a, intervalMinutes: change.intervalMinutes } : a,
  );
  const projected = estimateWorkspaceMonthlyRequests(
    projectedAccounts,
    STANDARD_MIN_INTERVAL_MINUTES,
  );
  const quota = evaluateQuota({ projected, used, cap });

  if (quota.exceeds) {
    return {
      ok: false,
      reason:
        `This interval would need ~${projected.toLocaleString("en-US")} requests/month ` +
        `on top of ${used.toLocaleString("en-US")} already used — over the enforced ` +
        `limit of ${quota.enforcedCap.toLocaleString("en-US")} of ${cap.toLocaleString("en-US")}.`,
      quota,
      intervalMinutes: change.intervalMinutes,
      monthlyRequestsForProfile,
    };
  }

  const { error } = await supabaseAdmin
    .from("monitor_accounts")
    .update({
      interval_minutes: change.intervalMinutes,
      high_frequency_opt_in: change.highFrequencyOptIn,
    })
    .eq("id", change.accountId);

  if (error) {
    return {
      ok: false,
      reason: error.message,
      quota,
      intervalMinutes: change.intervalMinutes,
      monthlyRequestsForProfile,
    };
  }

  return { ok: true, quota, intervalMinutes: change.intervalMinutes, monthlyRequestsForProfile };
}
