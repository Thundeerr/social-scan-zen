/**
 * Scanner server functions.
 *
 * All RapidAPI access happens exclusively inside these handlers or the
 * server-only helpers they import. `RAPIDAPI_KEY` and `RAPIDAPI_HOST` are
 * read via `process.env` at request time — never at module scope, never in
 * the client bundle, and never returned to the browser.
 *
 * Public surface:
 *  - `scanAccountNowFn(accountId)`     — manual scan of an existing tracked account
 *  - `scanSingleAccountFn(username)`   — test entry point: username → normalized scan
 *  - `runQueueTickFn()`                — run one autonomous tick
 *  - `providerHealthFn()`              — read-only provider health status
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---------- Types shared with the frontend ------------------------------------

/**
 * Clean, serialisable result returned to the browser. Contains no secrets,
 * no raw provider payload, and no internal error stacks.
 */
export type ScannerResult = {
  ok: boolean;
  accountId: string;
  username: string;
  runId: string;
  status: "completed" | "failed";
  detected: number;
  inserted: number;
  duplicates: number;
  error?: string;
};

export type ProviderHealth = {
  configured: boolean;
  host: string | null; // host is public knowledge (used in URLs), the key is not
  lastError: string | null;
  lastErrorAt: string | null;
  lastSuccessAt: string | null;
  message: string;
};

// ---------- Manual scan of an existing account --------------------------------

export const scanAccountNowFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { accountId: string }) =>
    z.object({ accountId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { scanAccountNow } = await import("@/lib/scanner-service.server");
    return scanAccountNow(context.supabase, data.accountId);
  });

// ---------- Test entry: scan by username --------------------------------------

const USERNAME_RE = /^[A-Za-z0-9._]{1,30}$/;

/**
 * `scanSingleAccount(username)` — the operator-facing test path.
 *
 * Given a raw username, this:
 *   1. Sanitises the handle (strips @, lowercases).
 *   2. Resolves it to a `tracked_accounts` row (creating one on first sight).
 *   3. Delegates to `scanAccountNow`, which fetches from RapidAPI, normalises
 *      the payload, upserts assets keyed on `(account_id, external_id)` so
 *      duplicates are ignored at the DB layer, and records a `scanner_runs`
 *      row with any provider error.
 *   4. Returns a clean `ScannerResult` — never the raw provider response.
 */
export const scanSingleAccountFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { username: string }) =>
    z.object({ username: z.string().min(1).max(64) }).parse(data),
  )
  .handler(async ({ data, context }): Promise<ScannerResult> => {
    const username = data.username.trim().replace(/^@/, "").toLowerCase();
    if (!USERNAME_RE.test(username)) {
      throw new Error("Invalid Instagram username");
    }

    const supabase = context.supabase;

    // Resolve to tracked_accounts.id, inserting if the operator has never
    // seen this handle before. RLS gates insert to operators.
    let accountId: string | null = null;
    {
      const { data: existing, error } = await supabase
        .from("tracked_accounts")
        .select("id")
        .eq("username", username)
        .maybeSingle();
      if (error) throw new Error(`Lookup failed: ${error.message}`);
      accountId = existing?.id ?? null;
    }

    if (!accountId) {
      const { data: created, error } = await supabase
        .from("tracked_accounts")
        .insert({
          username,
          display_name: username,
          status: "active",
          tier: "B",
          created_by: context.userId,
        })
        .select("id")
        .single();
      if (error || !created) {
        throw new Error(`Could not track @${username}: ${error?.message ?? "unknown"}`);
      }
      accountId = created.id;
    }

    const { scanAccountNow } = await import("@/lib/scanner-service.server");
    try {
      const outcome = await scanAccountNow(supabase, accountId);
      return {
        ok: outcome.status === "completed",
        accountId: outcome.accountId,
        username: outcome.username,
        runId: outcome.runId,
        status: outcome.status,
        detected: outcome.detected,
        inserted: outcome.inserted,
        duplicates: outcome.duplicates,
        error: outcome.error,
      };
    } catch (err) {
      // Never leak stack traces; the underlying scanner already logged into
      // scanner_runs + activity_log if the failure happened mid-scan.
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(message);
    }
  });

// ---------- Autonomous tick trigger (kept for debugging) ----------------------

export const runQueueTickFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { tickQueue } = await import("@/lib/scanner-service.server");
    return tickQueue(context.supabase);
  });

// ---------- Provider health ---------------------------------------------------

/**
 * Reports provider configuration + most recent successful/failed run so the
 * Scanner page can show operational status without ever exposing the key.
 *
 * `RAPIDAPI_KEY` is only checked for presence — its value never leaves the
 * server. `RAPIDAPI_HOST` is public (it's used in the request URL) so we do
 * return it so the operator can confirm which endpoint is wired.
 */
export const providerHealthFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ProviderHealth> => {
    const hasKey = Boolean(process.env.RAPIDAPI_KEY);
    const host = process.env.RAPIDAPI_HOST ?? null;
    const configured = hasKey && Boolean(host);

    const supabase = context.supabase;

    const [{ data: lastOk }, { data: lastErr }] = await Promise.all([
      supabase
        .from("scanner_runs")
        .select("completed_at")
        .eq("status", "completed")
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("scanner_runs")
        .select("completed_at,error")
        .eq("status", "failed")
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    let message = "Provider ready";
    if (!hasKey && !host) message = "RAPIDAPI_KEY and RAPIDAPI_HOST are not configured";
    else if (!hasKey) message = "RAPIDAPI_KEY is not configured";
    else if (!host) message = "RAPIDAPI_HOST is not configured";
    else if (lastErr?.completed_at && (!lastOk?.completed_at || lastErr.completed_at > lastOk.completed_at))
      message = "Provider recently returned an error";

    return {
      configured,
      host,
      lastError: lastErr?.error ?? null,
      lastErrorAt: lastErr?.completed_at ?? null,
      lastSuccessAt: lastOk?.completed_at ?? null,
      message,
    };
  });

// ---------- Provider budget ---------------------------------------------------

/**
 * Returns the current-month RapidAPI request budget so the UI can show a
 * live gauge and warn before the cap is hit. `used` counts every scanner_run
 * (completed OR failed) created since the first of the current UTC month —
 * failed runs still consume provider quota, so they count.
 */
export const providerBudgetFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getBudgetStatus } = await import("@/lib/scanner-service.server");
    return getBudgetStatus(context.supabase);
  });

// ---------- Burn forecast -----------------------------------------------------

/**
 * Burn-rate telemetry for the "Token Burn" console. Combines current-month
 * budget consumption with the size of the active fleet and the fixed
 * autonomous cadence (4 scans / day / account, ~6h intervals) to project
 * daily, weekly, and monthly provider request usage.
 *
 * `actualLast24h` counts scanner_runs created in the last rolling 24 hours
 * so the operator can compare "what the fleet is actually spending" against
 * "what the schedule predicts".
 */
export type BurnForecast = {
  activeAccounts: number;
  scansPerAccountPerDay: number;
  projectedPerDay: number;
  projectedPerWeek: number;
  projectedPerMonth: number;
  actualLast24h: number;
  actualLast7d: number;
  daysUntilCap: number | null; // null = never (projection ≤ 0)
  budget: {
    used: number;
    monthlyCap: number;
    remaining: number;
    percentUsed: number;
    periodStart: string;
    periodEnd: string;
    warning: boolean;
    exhausted: boolean;
  };
};

export const burnForecastFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BurnForecast> => {
    const { getBudgetStatus } = await import("@/lib/scanner-service.server");
    const budget = await getBudgetStatus(context.supabase);

    const { count: activeCount } = await context.supabase
      .from("tracked_accounts")
      .select("id", { count: "exact", head: true })
      .eq("status", "active");
    const activeAccounts = activeCount ?? 0;

    const scansPerAccountPerDay = 4; // 4×/day autonomous cadence
    const projectedPerDay = activeAccounts * scansPerAccountPerDay;
    const projectedPerWeek = projectedPerDay * 7;
    const projectedPerMonth = projectedPerDay * 30;

    const now = Date.now();
    const dayAgo = new Date(now - 24 * 60 * 60_000).toISOString();
    const weekAgo = new Date(now - 7 * 24 * 60 * 60_000).toISOString();
    const { count: c24 } = await context.supabase
      .from("scanner_runs")
      .select("id", { count: "exact", head: true })
      .gte("created_at", dayAgo);
    const { count: c7d } = await context.supabase
      .from("scanner_runs")
      .select("id", { count: "exact", head: true })
      .gte("created_at", weekAgo);

    const daysUntilCap =
      projectedPerDay > 0 ? budget.remaining / projectedPerDay : null;

    return {
      activeAccounts,
      scansPerAccountPerDay,
      projectedPerDay,
      projectedPerWeek,
      projectedPerMonth,
      actualLast24h: c24 ?? 0,
      actualLast7d: c7d ?? 0,
      daysUntilCap,
      budget: {
        used: budget.used,
        monthlyCap: budget.monthlyCap,
        remaining: budget.remaining,
        percentUsed: budget.percentUsed,
        periodStart: budget.periodStart,
        periodEnd: budget.periodEnd,
        warning: budget.warning,
        exhausted: budget.exhausted,
      },
    };
  });

