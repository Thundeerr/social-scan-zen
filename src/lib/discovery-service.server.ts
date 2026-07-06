/**
 * DiscoveryService — server-only.
 *
 * Second autonomous pipeline next to the scanner:
 *   - runDiscoveryForSeedAccount / Location  → derive candidates from a
 *     tracked seed's cached assets, upsert into discovery_candidates and
 *     append discovery_signals rows.
 *   - enrichPendingCandidates                 → fetch profile + AI score
 *     for newly-surfaced candidates.
 *   - applyOperatorDecision                    → track / ignore / blacklist a
 *     candidate and fold that verdict back into discovery_preferences.
 *   - tickDiscovery                            → pick the oldest seeds and
 *     enrich a bounded number of candidates per invocation.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { extractSignalsFromAssets } from "./discovery-extract.server";
import { getInstagramProviderFromEnv } from "./instagram-provider.server";
import { getBudgetStatus } from "./scanner-service.server";

type DB = SupabaseClient<Database>;

type Decision = "track" | "ignore" | "blacklist";

const DISCOVERY_INTERVAL_MIN = 6 * 60; // rerun discovery per seed every ~6h
const ENRICH_THRESHOLD = 1;             // enrich after this many signals

// ---------- Seed passes ---------------------------------------------------

async function fetchAssetsForAccount(db: DB, accountId: string, limit = 60) {
  const { data, error } = await db
    .from("assets")
    .select("caption, source_url")
    .eq("account_id", accountId)
    .order("posted_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

async function fetchAssetsForLocation(db: DB, locationRowId: string, limit = 60) {
  const { data, error } = await db
    .from("assets")
    .select("caption, source_url")
    .eq("location_id", locationRowId)
    .order("posted_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

async function upsertCandidatesAndSignals(
  db: DB,
  userId: string,
  signals: {
    username: string;
    source: "account_mention" | "hashtag_cooccurrence";
    weight: number;
  }[],
  seed: { accountId?: string | null; locationId?: string | null },
  parent?: { candidateId: string | null; depth: number },
) {
  if (!signals.length) return 0;

  // Filter blacklist
  const usernames = signals.map((s) => s.username);
  const { data: black } = await db
    .from("discovery_blacklist")
    .select("username")
    .eq("user_id", userId)
    .in("username", usernames);
  const blacklisted = new Set((black ?? []).map((r) => r.username));

  const kept = signals.filter((s) => !blacklisted.has(s.username));
  if (!kept.length) return 0;

  // Upsert candidates one shot
  const nowIso = new Date().toISOString();
  const { data: existing, error: existErr } = await db
    .from("discovery_candidates")
    .select("id, username, signal_count")
    .eq("user_id", userId)
    .in("username", kept.map((s) => s.username));
  if (existErr) throw existErr;

  const byName = new Map<string, { id: string; signal_count: number }>();
  for (const row of existing ?? []) {
    byName.set(row.username, { id: row.id, signal_count: row.signal_count ?? 0 });
  }

  const toInsert: Array<{
    user_id: string;
    username: string;
    signal_count: number;
    last_seen_at: string;
    parent_candidate_id?: string | null;
    depth?: number;
  }> = [];
  const toBump: Array<{ id: string; signal_count: number }> = [];

  const parentId = parent?.candidateId ?? null;
  const childDepth = parent ? parent.depth + 1 : 0;

  for (const sig of kept) {
    const cur = byName.get(sig.username);
    if (cur) {
      toBump.push({ id: cur.id, signal_count: cur.signal_count + sig.weight });
    } else {
      toInsert.push({
        user_id: userId,
        username: sig.username,
        signal_count: sig.weight,
        last_seen_at: nowIso,
        parent_candidate_id: parentId,
        depth: childDepth,
      });
    }
  }

  if (toInsert.length) {
    const { data, error } = await db
      .from("discovery_candidates")
      .insert(toInsert)
      .select("id, username");
    if (error) throw error;
    for (const row of data ?? []) byName.set(row.username, { id: row.id, signal_count: 0 });
  }
  for (const bump of toBump) {
    await db
      .from("discovery_candidates")
      .update({ signal_count: bump.signal_count, last_seen_at: nowIso })
      .eq("id", bump.id);
  }

  // Signal rows
  const signalRows = kept
    .map((sig) => {
      const cand = byName.get(sig.username);
      if (!cand) return null;
      return {
        user_id: userId,
        candidate_id: cand.id,
        username: sig.username,
        source_type: sig.source,
        seed_account_id: seed.accountId ?? null,
        seed_location_id: seed.locationId ?? null,
        weight: sig.weight,
      };
    })
    .filter((r): r is NonNullable<typeof r> => Boolean(r));

  if (signalRows.length) {
    const { error } = await db.from("discovery_signals").insert(signalRows);
    if (error) throw error;
  }

  return kept.length;
}


export async function runDiscoveryForSeedAccount(db: DB, accountId: string) {
  const { data: acct, error } = await db
    .from("tracked_accounts")
    .select("id, username, created_by")
    .eq("id", accountId)
    .maybeSingle();
  if (error) throw error;
  if (!acct?.created_by) return { candidates: 0 };

  const assets = await fetchAssetsForAccount(db, accountId);
  const signals = extractSignalsFromAssets(assets, acct.username);
  const affected = await upsertCandidatesAndSignals(db, acct.created_by, signals, {
    accountId,
  });

  await db
    .from("tracked_accounts")
    .update({ last_discovery_at: new Date().toISOString() })
    .eq("id", accountId);
  return { candidates: affected };
}

export async function runDiscoveryForSeedLocation(db: DB, locationRowId: string) {
  const { data: loc, error } = await db
    .from("tracked_locations")
    .select("id, name, created_by")
    .eq("id", locationRowId)
    .maybeSingle();
  if (error) throw error;
  if (!loc?.created_by) return { candidates: 0 };

  const assets = await fetchAssetsForLocation(db, locationRowId);
  const signals = extractSignalsFromAssets(assets, null);
  const affected = await upsertCandidatesAndSignals(db, loc.created_by, signals, {
    locationId: locationRowId,
  });

  await db
    .from("tracked_locations")
    .update({ last_discovery_at: new Date().toISOString() })
    .eq("id", locationRowId);
  return { candidates: affected };
}

// ---------- Enrichment ----------------------------------------------------

type AxisVerdict = { score: number; reasons: string[] };

type AiVerdict = {
  luxury: AxisVerdict;
  quality: AxisVerdict;
  aesthetic: AxisVerdict;
  travel: AxisVerdict;
  authenticity: AxisVerdict;
  p_private_individual: number;
  p_commercial_brand: number;
  estimated_niche: string;
  estimated_post_frequency: string;
  summary: string;
  confidence: number;
};

const LOVABLE_MODEL = "google/gemini-2.5-flash";

async function callLovableAi(payload: {
  username: string;
  full_name: string | null;
  followers: number | null;
  following: number | null;
  posts_count: number | null;
  is_private: boolean | null;
  is_verified: boolean | null;
  signals: Array<{ source_type: string; count: number }>;
  captions: string[];
}): Promise<AiVerdict | null> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return null;

  const axis = {
    type: "object",
    additionalProperties: false,
    required: ["score", "reasons"],
    properties: {
      score: { type: "integer" },
      reasons: {
        type: "array",
        items: { type: "string" },
      },
    },
  };

  const body = {
    model: LOVABLE_MODEL,
    messages: [
      {
        role: "system",
        content:
          "You are an elite intelligence analyst inside an autonomous account-discovery platform. For every Instagram account you evaluate five axes on a 0–100 scale: luxury, content quality, aesthetic consistency, travel intensity, and authenticity. For EACH axis you MUST return between 3 and 5 short, concrete, evidence-based reasons in operator English (e.g. \"Frequently posts from Aman properties\", \"Multiple private aviation appearances\", \"High-end restaurants dominate content\"). Never repeat the axis name inside its own reasons. Also estimate the probability that the account is a private individual vs. a commercial brand (each between 0 and 1, together ≤ 1), a 1–3 word niche, a posting frequency in short natural English, a one-sentence summary, and a confidence between 0 and 1. Be conservative when the data is thin — pull confidence down accordingly. Respond in JSON matching the schema.",
      },
      {
        role: "user",
        content: JSON.stringify(payload),
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "discovery_verdict",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: [
            "luxury",
            "quality",
            "aesthetic",
            "travel",
            "authenticity",
            "p_private_individual",
            "p_commercial_brand",
            "estimated_niche",
            "estimated_post_frequency",
            "summary",
            "confidence",
          ],
          properties: {
            luxury: axis,
            quality: axis,
            aesthetic: axis,
            travel: axis,
            authenticity: axis,
            p_private_individual: { type: "number" },
            p_commercial_brand: { type: "number" },
            estimated_niche: { type: "string" },
            estimated_post_frequency: { type: "string" },
            summary: { type: "string" },
            confidence: { type: "number" },
          },
        },
      },
    },
  };

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.warn("[discovery] AI call failed", res.status, text.slice(0, 200));
    return null;
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content ?? "";
  try {
    return JSON.parse(content) as AiVerdict;
  } catch {
    return null;
  }
}

const clampScore = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const clampReasons = (r: string[] | undefined) =>
  (r ?? [])
    .filter((x) => typeof x === "string" && x.trim().length > 0)
    .slice(0, 5)
    .map((x) => x.trim());


async function fetchProfileSummary(username: string) {
  try {
    const provider = getInstagramProviderFromEnv();
    const res = await provider.fetchAccount(username);
    return {
      full_name: res.display_name ?? null,
      avatar_url: res.avatar_url ?? null,
      captions: res.posts.slice(0, 8).map((p) => p.caption).filter((c) => c && c.length),
      posts_count: res.posts.length || null,
    };
  } catch (err) {
    console.warn("[discovery] profile fetch failed for", username, err);
    return null;
  }
}

export async function enrichCandidate(db: DB, candidateId: string) {
  const { data: cand, error } = await db
    .from("discovery_candidates")
    .select("id, user_id, username, state, signal_count")
    .eq("id", candidateId)
    .maybeSingle();
  if (error || !cand) return { ok: false, reason: "not_found" as const };
  if (cand.state !== "new") return { ok: false, reason: "not_new" as const };

  const profile = await fetchProfileSummary(cand.username);

  // Signal summary for the AI
  const { data: sigRows } = await db
    .from("discovery_signals")
    .select("source_type")
    .eq("candidate_id", cand.id);
  const counts = new Map<string, number>();
  for (const s of sigRows ?? []) counts.set(s.source_type, (counts.get(s.source_type) ?? 0) + 1);
  const signalSummary = [...counts.entries()].map(([source_type, count]) => ({
    source_type,
    count,
  }));

  const verdict = await callLovableAi({
    username: cand.username,
    full_name: profile?.full_name ?? null,
    followers: null,
    following: null,
    posts_count: profile?.posts_count ?? null,
    is_private: null,
    is_verified: null,
    signals: signalSummary,
    captions: profile?.captions ?? [],
  });

  const patch: Database["public"]["Tables"]["discovery_candidates"]["Update"] = {
    last_ai_at: new Date().toISOString(),
  };
  if (profile?.full_name) patch.full_name = profile.full_name;
  if (profile?.avatar_url) patch.avatar_url = profile.avatar_url;

  if (verdict) {
    const luxury = clampScore(verdict.luxury.score);
    const quality = clampScore(verdict.quality.score);
    const aesthetic = clampScore(verdict.aesthetic.score);
    const travel = clampScore(verdict.travel.score);
    const authenticity = clampScore(verdict.authenticity.score);
    patch.luxury_score = luxury;
    patch.quality_score = quality;
    patch.aesthetic_score = aesthetic;
    patch.travel_score = travel;
    patch.authenticity_score = authenticity;
    patch.score_reasons = {
      luxury: clampReasons(verdict.luxury.reasons),
      quality: clampReasons(verdict.quality.reasons),
      aesthetic: clampReasons(verdict.aesthetic.reasons),
      travel: clampReasons(verdict.travel.reasons),
      authenticity: clampReasons(verdict.authenticity.reasons),
    };
    patch.p_private_individual = verdict.p_private_individual;
    patch.p_commercial_brand = verdict.p_commercial_brand;
    patch.estimated_niche = verdict.estimated_niche;
    patch.estimated_post_frequency = verdict.estimated_post_frequency;
    patch.ai_summary = verdict.summary;
    patch.confidence = Math.max(
      0,
      Math.min(
        1,
        verdict.confidence * Math.min(1, 0.2 + 0.15 * (cand.signal_count ?? 0)),
      ),
    );
    patch.rank_score = await computeRankScore(db, cand.user_id, {
      luxury,
      quality,
      aesthetic,
      travel,
      authenticity,
      niche: verdict.estimated_niche,
      confidence: verdict.confidence,
    });
  }

  await db.from("discovery_candidates").update(patch).eq("id", cand.id);
  return { ok: true as const };
}

async function computeRankScore(
  db: DB,
  userId: string,
  v: {
    luxury: number;
    quality: number;
    aesthetic: number;
    travel: number;
    authenticity: number;
    niche: string;
    confidence: number;
  },
) {
  const { data: prefs } = await db
    .from("discovery_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  const p = prefs ?? {
    avg_luxury: 50,
    avg_quality: 50,
    avg_aesthetic: 50,
    avg_travel: 50,
    avg_authenticity: 50,
    niche_weights: {} as Record<string, number>,
  };
  const nicheWeights = (p.niche_weights ?? {}) as Record<string, number>;
  const nicheMatch =
    v.niche && nicheWeights[v.niche.toLowerCase()]
      ? Math.min(1, (nicheWeights[v.niche.toLowerCase()] as number) / 3)
      : 0.3;

  const normalised = (score: number, pref: number) => {
    const distance = Math.abs(score - pref);
    return Math.max(0, 1 - distance / 100);
  };
  return (
    0.35 * nicheMatch +
    0.15 * normalised(v.luxury, p.avg_luxury as number) +
    0.15 * normalised(v.quality, p.avg_quality as number) +
    0.1 * normalised(v.aesthetic, p.avg_aesthetic as number) +
    0.1 * normalised(v.travel, p.avg_travel as number) +
    0.05 * normalised(v.authenticity, p.avg_authenticity as number) +
    0.1 * v.confidence
  );
}

export async function enrichPendingCandidates(db: DB, userId: string, limit = 3) {
  const { data: pending } = await db
    .from("discovery_candidates")
    .select("id")
    .eq("user_id", userId)
    .eq("state", "new")
    .is("last_ai_at", null)
    .gte("signal_count", ENRICH_THRESHOLD)
    .order("signal_count", { ascending: false })
    .limit(limit);

  const results: Array<{ id: string; ok: boolean }> = [];
  // Respect provider budget — profile fetch counts against RapidAPI quota
  const budget = await getBudgetStatus(db);
  const budgetSlots = Math.min(limit, budget.remaining);

  for (const row of (pending ?? []).slice(0, budgetSlots)) {
    const r = await enrichCandidate(db, row.id);
    results.push({ id: row.id, ok: r.ok });
  }
  return { enriched: results.filter((r) => r.ok).length, attempted: results.length };
}

// ---------- Operator decision + learning ----------------------------------

export async function applyOperatorDecision(db: DB, candidateId: string, decision: Decision) {
  const { data: cand, error } = await db
    .from("discovery_candidates")
    .select("*")
    .eq("id", candidateId)
    .maybeSingle();
  if (error || !cand) throw new Error("Candidate not found");

  const nextState: Database["public"]["Enums"]["discovery_state"] =
    decision === "track" ? "tracked" : decision === "ignore" ? "ignored" : "blacklisted";

  await db
    .from("discovery_candidates")
    .update({ state: nextState })
    .eq("id", candidateId);

  if (decision === "blacklist") {
    await db
      .from("discovery_blacklist")
      .insert({ user_id: cand.user_id, username: cand.username })
      .then(() => undefined, () => undefined); // ignore duplicate errors
  }

  await updatePreferences(db, cand, decision);
  return { state: nextState };
}

async function updatePreferences(
  db: DB,
  cand: Database["public"]["Tables"]["discovery_candidates"]["Row"],
  decision: Decision,
) {
  const { data: prefs } = await db
    .from("discovery_preferences")
    .select("*")
    .eq("user_id", cand.user_id)
    .maybeSingle();

  const cur = prefs ?? {
    user_id: cand.user_id,
    avg_luxury: 50,
    avg_quality: 50,
    avg_aesthetic: 50,
    avg_travel: 50,
    avg_authenticity: 50,
    pref_private: 0.5,
    pref_commercial: 0.5,
    niche_weights: {} as Record<string, number>,
    signal_weights: {} as Record<string, number>,
    sample_size: 0,
  };

  const sample = cur.sample_size ?? 0;
  const alpha = 1 / Math.min(50, sample + 1);
  const dir = decision === "track" ? 1 : decision === "ignore" ? -0.3 : -1;

  const ema = (avg: number, val: number | null) =>
    val == null ? avg : avg + alpha * dir * (val - avg);

  const nicheWeights = { ...((cur.niche_weights ?? {}) as Record<string, number>) };
  if (cand.estimated_niche) {
    const k = cand.estimated_niche.toLowerCase();
    nicheWeights[k] = (nicheWeights[k] ?? 0) + dir;
  }

  const patch = {
    user_id: cand.user_id,
    avg_luxury: ema(cur.avg_luxury as number, cand.luxury_score),
    avg_quality: ema(cur.avg_quality as number, cand.quality_score),
    avg_aesthetic: ema(cur.avg_aesthetic as number, cand.aesthetic_score),
    avg_travel: ema(cur.avg_travel as number, cand.travel_score),
    avg_authenticity: ema(cur.avg_authenticity as number, cand.authenticity_score),
    pref_private:
      cand.p_private_individual == null
        ? cur.pref_private
        : ema(cur.pref_private as number, cand.p_private_individual * 100) / 100,
    pref_commercial:
      cand.p_commercial_brand == null
        ? cur.pref_commercial
        : ema(cur.pref_commercial as number, cand.p_commercial_brand * 100) / 100,
    niche_weights: nicheWeights,
    signal_weights: cur.signal_weights,
    sample_size: sample + 1,
  };

  await db.from("discovery_preferences").upsert(patch, { onConflict: "user_id" });
}

// ---------- Tick ----------------------------------------------------------

/**
 * Pick a few seeds with the oldest last_discovery_at and derive candidates
 * for each. Then enrich a bounded number of pending candidates per user.
 */
export async function tickDiscovery(
  db: DB,
  { maxSeeds = 5, enrichPerUser = 2 }: { maxSeeds?: number; enrichPerUser?: number } = {},
) {
  const cutoff = new Date(Date.now() - DISCOVERY_INTERVAL_MIN * 60_000).toISOString();

  const { data: dueAccounts } = await db
    .from("tracked_accounts")
    .select("id")
    .eq("status", "active")
    .or(`last_discovery_at.is.null,last_discovery_at.lt.${cutoff}`)
    .order("last_discovery_at", { ascending: true, nullsFirst: true })
    .limit(maxSeeds);

  const { data: dueLocations } = await db
    .from("tracked_locations")
    .select("id")
    .eq("status", "active")
    .or(`last_discovery_at.is.null,last_discovery_at.lt.${cutoff}`)
    .order("last_discovery_at", { ascending: true, nullsFirst: true })
    .limit(maxSeeds);

  let seededCandidates = 0;
  const affectedUsers = new Set<string>();

  for (const a of dueAccounts ?? []) {
    const r = await runDiscoveryForSeedAccount(db, a.id);
    seededCandidates += r.candidates;
  }
  for (const l of dueLocations ?? []) {
    const r = await runDiscoveryForSeedLocation(db, l.id);
    seededCandidates += r.candidates;
  }

  // Gather user ids that got new signals
  const { data: recent } = await db
    .from("discovery_candidates")
    .select("user_id")
    .eq("state", "new")
    .is("last_ai_at", null)
    .gte("signal_count", ENRICH_THRESHOLD)
    .limit(200);
  for (const row of recent ?? []) affectedUsers.add(row.user_id);

  let enriched = 0;
  for (const uid of affectedUsers) {
    const r = await enrichPendingCandidates(db, uid, enrichPerUser);
    enriched += r.enriched;
  }

  return {
    seeded_candidates: seededCandidates,
    enriched_candidates: enriched,
    accounts_seeded: (dueAccounts ?? []).length,
    locations_seeded: (dueLocations ?? []).length,
  };
}
