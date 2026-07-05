/**
 * ScannerService — server-only.
 *
 * Owns the autonomous scanning lifecycle:
 *  - `tickQueue`   → pick due accounts, enqueue scanner_runs, execute them
 *  - `scanAccount` → run a single account (used by manual "Scan Now")
 *
 * Every scan is idempotent per-account (asset upsert on (account_id,
 * external_id)) and schedules the next run ~8 hours ahead with
 * exponential backoff on failure.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  getInstagramProviderFromEnv,
  describeProviderRequest,
  type ProviderPost,
} from "./instagram-provider.server";

type DB = SupabaseClient<Database>;

// Autonomous cadence: every ~8 hours, with ±30min jitter so a large fleet
// doesn't stampede the provider on the hour. On-demand scans bypass this
// schedule entirely via `scanAccountNow`.
const MIN_INTERVAL_MIN = 8 * 60 - 30; // 7h30m
const MAX_INTERVAL_MIN = 8 * 60 + 30; // 8h30m
const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MIN = 5; // 5, 10, 20, 40, 80 min

function randomIntervalMs(minMin: number, maxMin: number) {
  const span = (maxMin - minMin) * 60_000;
  return minMin * 60_000 + Math.random() * span;
}

function nextScanIso() {
  return new Date(Date.now() + randomIntervalMs(MIN_INTERVAL_MIN, MAX_INTERVAL_MIN)).toISOString();
}

function backoffIso(attempt: number) {
  const minutes = BASE_BACKOFF_MIN * Math.pow(2, Math.max(0, attempt - 1));
  return new Date(Date.now() + Math.min(minutes, 120) * 60_000).toISOString();
}

export type ScanOutcome = {
  runId: string;
  accountId: string;
  username: string;
  status: "completed" | "failed";
  detected: number;
  inserted: number;
  duplicates: number;
  error?: string;
};

// ---------- Provider request budget --------------------------------------------------
//
// Every RapidAPI call counts against a monthly cap (default 40,000). We
// approximate "one scanner_run = one provider request", which matches how
// executeScan is structured (single fetchAccount call per run). Manual and
// autonomous scans both consult this budget before spending a request, so a
// runaway cadence can never overshoot the plan.

export type BudgetStatus = {
  monthlyCap: number;
  warnAtPercent: number;
  used: number;
  remaining: number;
  percentUsed: number;
  periodStart: string; // ISO — first day of current month, UTC
  periodEnd: string;   // ISO — first day of next month, UTC (exclusive)
  exhausted: boolean;
  warning: boolean;
};

function currentPeriod(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

/**
 * Read the current monthly budget status. `used` counts every scanner_run
 * created in the current UTC month — including failed runs, since a failed
 * request still consumes provider quota.
 */
export async function getBudgetStatus(db: DB): Promise<BudgetStatus> {
  const { start, end } = currentPeriod();
  const { data: cfg } = await db
    .from("provider_budget")
    .select("monthly_cap, warn_at_percent")
    .eq("id", true)
    .maybeSingle();
  const monthlyCap = cfg?.monthly_cap ?? 40_000;
  const warnAtPercent = cfg?.warn_at_percent ?? 85;

  const { count } = await db
    .from("scanner_runs")
    .select("id", { count: "exact", head: true })
    .gte("created_at", start.toISOString())
    .lt("created_at", end.toISOString());
  const used = count ?? 0;
  const remaining = Math.max(0, monthlyCap - used);
  const percentUsed = monthlyCap > 0 ? Math.min(100, (used / monthlyCap) * 100) : 100;

  return {
    monthlyCap,
    warnAtPercent,
    used,
    remaining,
    percentUsed,
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    exhausted: remaining <= 0,
    warning: percentUsed >= warnAtPercent,
  };
}

async function logBudgetBlocked(db: DB, budget: BudgetStatus, reason: string) {
  await db.from("activity_log").insert({
    event_type: "provider_budget_blocked",
    description: `Provider budget reached · ${budget.used}/${budget.monthlyCap} · ${reason}`,
    metadata: {
      used: budget.used,
      monthly_cap: budget.monthlyCap,
      period_start: budget.periodStart,
      period_end: budget.periodEnd,
    },
  });
}

async function setPhase(
  db: DB,
  runId: string,
  phase: string,
  detail: string,
  extra: Record<string, unknown> = {},
) {
  await db
    .from("scanner_runs")
    .update({ phase, phase_detail: detail, ...extra })
    .eq("id", runId);
}

export async function executeScan(
  db: DB,
  runId: string,
  accountId: string,
  username: string,
  attempt: number,
): Promise<ScanOutcome> {
  // Mark running + first visible phase
  await db
    .from("scanner_runs")
    .update({
      status: "running",
      started_at: new Date().toISOString(),
      phase: "connecting",
      phase_detail: `Establishing session with provider`,
      assets_found: 0,
    })
    .eq("id", runId);

  await db.from("activity_log").insert({
    event_type: "scan_started",
    description: `Scanning @${username}${attempt > 1 ? ` (attempt ${attempt})` : ""}`,
    metadata: { account_id: accountId, run_id: runId, attempt },
  });

  try {
    const provider = getInstagramProviderFromEnv();

    await setPhase(db, runId, "fetching", describeProviderRequest(username));
    const result = await provider.fetchAccount(username);

    await setPhase(
      db,
      runId,
      "parsing",
      `Normalising ${result.posts.length} item${result.posts.length === 1 ? "" : "s"}`,
      { assets_found: result.posts.length },
    );

    // Sync account metadata (avatar/display) when new info is present.
    const meta: { display_name?: string; avatar_url?: string } = {};
    if (result.display_name) meta.display_name = result.display_name;
    if (result.avatar_url) meta.avatar_url = result.avatar_url;
    if (Object.keys(meta).length) {
      await db.from("tracked_accounts").update(meta).eq("id", accountId);
    }

    const rows = result.posts.map((p: ProviderPost) => ({
      account_id: accountId,
      external_id: p.external_id,
      media_type: p.media_type,
      caption: p.caption,
      thumbnail_url: p.thumbnail_url,
      media_url: p.media_url,
      source_url: p.source_url,
      likes: p.likes,
      comments: p.comments,
      posted_at: p.posted_at,
    }));

    await setPhase(
      db,
      runId,
      "storing",
      `Reconciling ${rows.length} record${rows.length === 1 ? "" : "s"} against archive`,
    );

    let inserted = 0;
    let duplicates = 0;
    if (rows.length) {
      // Insert only truly new records. `ignoreDuplicates` skips any row that
      // conflicts on (account_id, external_id), so `data` is exactly the set
      // of freshly-created assets — never previously-seen ones.
      const { data, error } = await db
        .from("assets")
        .upsert(rows, { onConflict: "account_id,external_id", ignoreDuplicates: true })
        .select("id");
      if (error) throw error;
      inserted = data?.length ?? 0;
      duplicates = rows.length - inserted;

      // Refresh `last_seen_at` for every asset the provider returned this
      // scan — inserted rows already have it via the default, so this
      // primarily bumps the timestamp on duplicates so the operator can see
      // that the archive is still current.
      if (duplicates > 0) {
        const nowIso = new Date().toISOString();
        await db
          .from("assets")
          .update({ last_seen_at: nowIso })
          .eq("account_id", accountId)
          .in(
            "external_id",
            rows.map((r) => r.external_id).filter((x): x is string => Boolean(x)),
          );
      }
    }

    if (inserted > 0) {
      await db.from("activity_log").insert({
        event_type: "asset_detected",
        description: `Detected ${inserted} new asset${inserted === 1 ? "" : "s"} for @${username}`,
        metadata: { account_id: accountId, run_id: runId, inserted },
      });
    }

    await db
      .from("scanner_runs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        accounts_scanned: 1,
        assets_detected: inserted,
        assets_duplicates: duplicates,
        assets_found: rows.length,
        phase: "completed",
        phase_detail:
          inserted > 0
            ? `${inserted} new · ${duplicates} already archived`
            : `No new assets · ${duplicates} already archived`,
      })
      .eq("id", runId);

    await db
      .from("tracked_accounts")
      .update({
        last_scan_at: new Date().toISOString(),
        next_scan_at: nextScanIso(),
        consecutive_failures: 0,
        last_error: null,
      })
      .eq("id", accountId);

    await db.from("activity_log").insert({
      event_type: "scan_completed",
      description: `Checked @${username} · ${inserted} new asset${inserted === 1 ? "" : "s"}`,
      metadata: { account_id: accountId, run_id: runId, inserted, duplicates },
    });

    // Rich per-asset Telegram notifications — fire-and-forget. Fires for
    // every newly-inserted asset from an S/A-tier tracked account whose
    // owner has Telegram enabled. Each message carries the media preview,
    // metadata block, and inline action buttons handled by the public
    // /api/public/telegram/webhook route. Silent for B/C tier so the DM
    // channel stays high-signal.
    if (inserted > 0) {
      try {
        const { data: acct } = await db
          .from("tracked_accounts")
          .select("created_by, tier, username, display_name")
          .eq("id", accountId)
          .maybeSingle();
        const ownerId = acct?.created_by;
        const tier = acct?.tier;
        if (ownerId && (tier === "S" || tier === "A")) {
          const { data: prefs } = await db
            .from("profiles")
            .select("telegram_chat_id, telegram_enabled")
            .eq("id", ownerId)
            .maybeSingle();
          if (prefs?.telegram_enabled && prefs.telegram_chat_id) {
            const { data: freshRows } = await db
              .from("assets")
              .select(
                "id, caption, media_type, media_url, thumbnail_url, source_url, posted_at, detected_at, ai_verdict, ai_confidence, ai_reasons",
              )
              .eq("account_id", accountId)
              .gte("detected_at", new Date(Date.now() - 10 * 60_000).toISOString())
              .order("detected_at", { ascending: false })
              .limit(5); // cap per scan to avoid spam
            const handle = acct?.username ?? username;
            const displayName = acct?.display_name ?? null;
            const origin =
              process.env.LOVABLE_PUBLISHED_URL ??
              "https://social-scan-zen.lovable.app";
            const { sendDetectionCard } = await import("@/lib/telegram.server");
            for (const r of freshRows ?? []) {
              const reasons = Array.isArray(r.ai_reasons)
                ? (r.ai_reasons as unknown[]).filter(
                    (x): x is string => typeof x === "string",
                  )
                : [];
              const result = await sendDetectionCard(prefs.telegram_chat_id, {
                assetId: r.id,
                handle,
                displayName,
                caption: r.caption,
                postedAt: r.posted_at,
                detectedAt: r.detected_at,
                mediaType: r.media_type,
                mediaUrl: r.media_url,
                thumbnailUrl: r.thumbnail_url,
                sourceUrl: r.source_url,
                aiVerdict: r.ai_verdict,
                aiConfidence: r.ai_confidence,
                aiReasons: reasons,
                adminUrl: `${origin}/assets?focus=${r.id}`,
              });
              if (!result.ok) console.warn("[telegram] detection send failed", result.error);
            }
          }
        }
      } catch (notifyErr) {
        console.warn("[telegram] notify hook error", notifyErr);
      }
    }


    return {
      runId,
      accountId,
      username,
      status: "completed",
      detected: rows.length,
      inserted,
      duplicates,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const nextAttempt = attempt + 1;
    const willRetry = nextAttempt <= MAX_ATTEMPTS;

    await db
      .from("scanner_runs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error: message.slice(0, 500),
        phase: "failed",
        phase_detail: message.slice(0, 200),
      })
      .eq("id", runId);

    await db
      .from("tracked_accounts")
      .update({
        consecutive_failures: attempt,
        last_error: message.slice(0, 500),
        next_scan_at: willRetry ? backoffIso(attempt) : nextScanIso(),
      })
      .eq("id", accountId);

    await db.from("activity_log").insert({
      event_type: willRetry ? "scan_retry_scheduled" : "scan_failed",
      description: willRetry
        ? `Retry scheduled for @${username} (attempt ${nextAttempt})`
        : `Scan failed for @${username}`,
      metadata: { account_id: accountId, run_id: runId, error: message, attempt },
    });

    return {
      runId,
      accountId,
      username,
      status: "failed",
      detected: 0,
      inserted: 0,
      duplicates: 0,
      error: message,
    };
  }
}

/**
 * Enqueue and execute due accounts. Called by cron (typically every minute).
 *
 * `maxPerTick` bounds fan-out so a large fleet does not slam the provider.
 * Accounts already have a queued/running run are skipped (duplicate scan
 * prevention). Attempt count on the new run comes from
 * `consecutive_failures + 1` for the account so retries are visible.
 */
export async function tickQueue(db: DB, maxPerTick = 3): Promise<ScanOutcome[]> {
  const now = new Date().toISOString();

  // ---- Provider budget guard ----
  // Every scanner_run counts against the monthly RapidAPI cap. If the fleet
  // would blow past the cap, we simply do not spend more requests this tick.
  const budget = await getBudgetStatus(db);
  if (budget.exhausted) {
    await logBudgetBlocked(db, budget, "autonomous tick skipped");
    return [];
  }
  const budgetCap = Math.max(0, Math.min(maxPerTick, budget.remaining));
  if (budgetCap === 0) return [];

  // Accounts whose next_scan_at has passed and status = active.
  const { data: due, error: dueErr } = await db
    .from("tracked_accounts")
    .select("id, username, consecutive_failures")
    .eq("status", "active")
    .lte("next_scan_at", now)
    .order("next_scan_at", { ascending: true })
    .limit(budgetCap * 3);
  if (dueErr) throw dueErr;
  if (!due?.length) return [];

  // Randomise the selection order so scans distribute over time.
  const shuffled = [...due].sort(() => Math.random() - 0.5);

  // Skip accounts with an in-flight run (queued or running).
  const ids = shuffled.map((a) => a.id);
  const { data: busy } = await db
    .from("scanner_runs")
    .select("account_id")
    .in("account_id", ids)
    .in("status", ["queued", "running"]);
  const busyIds = new Set((busy ?? []).map((r) => r.account_id));

  const picks = shuffled.filter((a) => !busyIds.has(a.id)).slice(0, budgetCap);
  if (!picks.length) return [];

  // Create queued runs
  const runsInsert = picks.map((a) => ({
    status: "queued" as const,
    account_id: a.id,
    attempt: (a.consecutive_failures ?? 0) + 1,
    scheduled_for: now,
  }));
  const { data: runs, error: runsErr } = await db
    .from("scanner_runs")
    .insert(runsInsert)
    .select("id, account_id, attempt");
  if (runsErr) throw runsErr;

  const byAccount = new Map((runs ?? []).map((r) => [r.account_id, r]));
  const outcomes: ScanOutcome[] = [];
  for (const acc of picks) {
    const run = byAccount.get(acc.id);
    if (!run) continue;
    outcomes.push(await executeScan(db, run.id, acc.id, acc.username, run.attempt ?? 1));
  }
  return outcomes;
}

/**
 * Manual scan trigger. Creates a run and executes immediately, bypassing the
 * next_scan_at schedule but still respecting the duplicate-scan guard.
 * Refuses the request when the monthly provider budget is exhausted.
 */
export async function scanAccountNow(db: DB, accountId: string): Promise<ScanOutcome> {
  const budget = await getBudgetStatus(db);
  if (budget.exhausted) {
    await logBudgetBlocked(db, budget, "manual scan refused");
    throw new Error(
      `Monthly API budget reached (${budget.used}/${budget.monthlyCap}). Scans resume ${new Date(budget.periodEnd).toUTCString().slice(0, 16)}.`,
    );
  }

  const { data: account, error } = await db
    .from("tracked_accounts")
    .select("id, username, consecutive_failures")
    .eq("id", accountId)
    .maybeSingle();
  if (error || !account) throw new Error("Account not found");

  const { data: existing } = await db
    .from("scanner_runs")
    .select("id")
    .eq("account_id", accountId)
    .in("status", ["queued", "running"])
    .limit(1);
  if (existing && existing.length) {
    throw new Error("Scan already in progress for this account");
  }

  const { data: run, error: runErr } = await db
    .from("scanner_runs")
    .insert({
      status: "queued",
      account_id: accountId,
      attempt: (account.consecutive_failures ?? 0) + 1,
      scheduled_for: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (runErr || !run) throw runErr ?? new Error("Failed to enqueue run");

  return executeScan(db, run.id, account.id, account.username, 1);
}
