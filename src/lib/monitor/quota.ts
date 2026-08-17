/**
 * Provider-quota math for the Account Status Watch monitor.
 *
 * Pure and browser-safe: the UI shows exactly the same numbers the server
 * enforces, because both import this module.
 */

/** Default floor. Every account sits here unless high frequency is opted into. */
export const STANDARD_MIN_INTERVAL_MINUTES = 180;

/** Absolute floor, only reachable with a deliberate per-account opt-in. */
export const HIGH_FREQUENCY_MIN_INTERVAL_MINUTES = 30;

export const MAX_INTERVAL_MINUTES = 2880;

/** 30 days — the billing window the provider quota is expressed in. */
export const MINUTES_PER_MONTH = 30 * 24 * 60;

/** Leave headroom so scans/retries can't be starved by monitor traffic. */
export const QUOTA_SAFETY_PERCENT = 90;

export function minIntervalFor(highFrequencyOptIn: boolean): number {
  return highFrequencyOptIn ? HIGH_FREQUENCY_MIN_INTERVAL_MINUTES : STANDARD_MIN_INTERVAL_MINUTES;
}

/** Requests a single profile costs per 30-day month at this interval. */
export function estimateMonthlyRequests(intervalMinutes: number): number {
  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) return 0;
  return Math.ceil(MINUTES_PER_MONTH / intervalMinutes);
}

export type QuotaAccount = {
  id: string;
  enabled: boolean;
  intervalMinutes: number | null;
};

/** Projected monthly monitor requests for a whole workspace. */
export function estimateWorkspaceMonthlyRequests(
  accounts: QuotaAccount[],
  defaultIntervalMinutes: number,
): number {
  return accounts
    .filter((a) => a.enabled)
    .reduce(
      (sum, a) => sum + estimateMonthlyRequests(a.intervalMinutes ?? defaultIntervalMinutes),
      0,
    );
}

export type QuotaVerdict = {
  /** Projected monthly monitor requests after the change. */
  projected: number;
  /** Requests already consumed this month by every source. */
  used: number;
  /** Workspace-wide monthly cap. */
  cap: number;
  /** Cap minus the safety headroom — the number actually enforced. */
  enforcedCap: number;
  remaining: number;
  percentOfCap: number;
  exceeds: boolean;
};

export function evaluateQuota(input: {
  projected: number;
  used: number;
  cap: number;
  safetyPercent?: number;
}): QuotaVerdict {
  const cap = Math.max(0, input.cap);
  const safety = input.safetyPercent ?? QUOTA_SAFETY_PERCENT;
  const enforcedCap = Math.floor((cap * safety) / 100);
  const total = input.projected + input.used;
  return {
    projected: input.projected,
    used: input.used,
    cap,
    enforcedCap,
    remaining: Math.max(0, enforcedCap - total),
    percentOfCap: cap === 0 ? 0 : Math.round((total / cap) * 100),
    exceeds: total > enforcedCap,
  };
}

export function formatInterval(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}
