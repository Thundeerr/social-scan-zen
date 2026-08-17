/**
 * Pure transition logic for the Instagram Private→Public monitor.
 * Browser-safe: no side effects, fully testable.
 */

import {
  MAX_INTERVAL_MINUTES as QUOTA_MAX_INTERVAL,
  STANDARD_MIN_INTERVAL_MINUTES,
  minIntervalFor,
} from "./quota";

/** Standard floor. High-frequency accounts opt down to 30 via `minIntervalFor`. */
export const MIN_INTERVAL_MINUTES = STANDARD_MIN_INTERVAL_MINUTES;
export const MAX_INTERVAL_MINUTES = QUOTA_MAX_INTERVAL;
export const RETRY_AFTER_MINUTES = 15;
export const MAX_JITTER_MINUTES = 5;


export type AccountState = {
  status_initialized: boolean;
  is_private: boolean | null;
  last_checked_at: string | null;
};

/** A transition only counts once the status baseline is known. */
export function isPrivateToPublic(state: AccountState, nextIsPrivate: boolean): boolean {
  return state.status_initialized === true && state.is_private === true && nextIsPrivate === false;
}

/** Deterministic key so concurrent runs collapse onto the same event row. */
export function buildTransitionKey(state: AccountState): string {
  return `private_to_public:${state.last_checked_at ?? "initial"}`;
}

export function isCooldownActive(
  lastEventAt: string | null,
  cooldownMinutes: number,
  now: Date = new Date(),
): boolean {
  if (!lastEventAt) return false;
  const elapsed = now.getTime() - new Date(lastEventAt).getTime();
  if (!Number.isFinite(elapsed)) return false;
  return elapsed < cooldownMinutes * 60_000;
}

/**
 * Clamp to the allowed window. `floor` defaults to the standard 180-minute
 * minimum; high-frequency accounts pass the lower opt-in floor explicitly.
 */
export function clampInterval(minutes: number, floor: number = MIN_INTERVAL_MINUTES): number {
  if (!Number.isFinite(minutes)) return floor;
  return Math.min(MAX_INTERVAL_MINUTES, Math.max(floor, Math.round(minutes)));
}

export function resolveIntervalMinutes(
  accountInterval: number | null | undefined,
  defaultInterval: number,
  opts: { highFrequencyOptIn?: boolean } = {},
): number {
  return clampInterval(accountInterval ?? defaultInterval, minIntervalFor(Boolean(opts.highFrequencyOptIn)));
}

/**
 * `intervalMinutes` is expected to be already resolved (see
 * `resolveIntervalMinutes`), so the absolute floor applies here — clamping to
 * the standard floor again would silently undo a high-frequency opt-in.
 */
export function nextCheckAt(
  intervalMinutes: number,
  now: Date = new Date(),
  jitterMinutes: number = Math.random() * MAX_JITTER_MINUTES,
): string {
  const clamped = clampInterval(intervalMinutes, HIGH_FREQUENCY_MIN_INTERVAL_MINUTES);
  const ms = (clamped + Math.max(0, jitterMinutes)) * 60_000;
  return new Date(now.getTime() + ms).toISOString();
}


export function retryAt(now: Date = new Date()): string {
  return new Date(now.getTime() + RETRY_AFTER_MINUTES * 60_000).toISOString();
}

/** Extract a real boolean `is_private`, including from a nested `body`. Never guesses. */
export function readIsPrivate(payload: unknown): boolean | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  if (typeof obj.is_private === "boolean") return obj.is_private;
  if (obj.body && typeof obj.body === "object") {
    const nested = readIsPrivate(obj.body);
    if (nested !== null) return nested;
  }
  if (obj.data && typeof obj.data === "object") {
    const nested = readIsPrivate(obj.data);
    if (nested !== null) return nested;
  }
  if (obj.user && typeof obj.user === "object") {
    const nested = readIsPrivate(obj.user);
    if (nested !== null) return nested;
  }
  return null;
}
