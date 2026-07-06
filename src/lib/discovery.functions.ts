/**
 * Discovery Engine — server functions.
 * All handlers scope to the authenticated operator via requireSupabaseAuth.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ScoreReasons = Partial<
  Record<"luxury" | "quality" | "aesthetic" | "travel" | "authenticity", string[]>
>;

export type DiscoveredViaHop = {
  id: string;
  username: string;
  kind: "candidate" | "origin";
};

export type DiscoveryCandidateRow = {
  id: string;
  username: string;
  full_name: string | null;
  avatar_url: string | null;
  followers: number | null;
  following: number | null;
  posts_count: number | null;
  is_private: boolean | null;
  is_verified: boolean | null;
  estimated_niche: string | null;
  ai_summary: string | null;
  luxury_score: number | null;
  quality_score: number | null;
  aesthetic_score: number | null;
  travel_score: number | null;
  authenticity_score: number | null;
  score_reasons: ScoreReasons;
  p_private_individual: number | null;
  p_commercial_brand: number | null;
  estimated_post_frequency: string | null;
  confidence: number;
  rank_score: number;
  state: "new" | "tracked" | "ignored" | "blacklisted";
  signal_count: number;
  depth: number;
  parent_candidate_id: string | null;
  first_seen_at: string;
  last_seen_at: string;
  last_ai_at: string | null;
  headline_signals: string[];
  discovered_via: DiscoveredViaHop[];
  signals: Array<{
    source_type: string;
    seed_account_id: string | null;
    seed_location_id: string | null;
    seed_hashtag: string | null;
    weight: number;
    created_at: string;
    seed_label: string | null;
  }>;
};


export const listDiscoveryCandidatesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { state?: string; limit?: number } | undefined) =>
    z
      .object({
        state: z.enum(["new", "tracked", "ignored", "blacklisted"]).optional(),
        limit: z.number().min(1).max(200).optional(),
      })
      .parse(data ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const state = data.state ?? "new";
    const limit = data.limit ?? 60;
    const { data: rows, error } = await supabase
      .from("discovery_candidates")
      .select("*")
      .eq("user_id", userId)
      .eq("state", state)
      .order("rank_score", { ascending: false })
      .order("signal_count", { ascending: false })
      .order("last_seen_at", { ascending: false })
      .limit(limit);
    if (error) throw error;

    const candidateIds = (rows ?? []).map((r) => r.id);
    let signalsByCandidate = new Map<string, DiscoveryCandidateRow["signals"]>();
    if (candidateIds.length) {
      const { data: sigs } = await supabase
        .from("discovery_signals")
        .select(
          "candidate_id, source_type, seed_account_id, seed_location_id, seed_hashtag, weight, created_at",
        )
        .in("candidate_id", candidateIds)
        .order("created_at", { ascending: false });

      const accountIds = [...new Set((sigs ?? []).map((s) => s.seed_account_id).filter((x): x is string => Boolean(x)))];
      const locationIds = [...new Set((sigs ?? []).map((s) => s.seed_location_id).filter((x): x is string => Boolean(x)))];
      const accountLabels = new Map<string, string>();
      const locationLabels = new Map<string, string>();
      if (accountIds.length) {
        const { data: accts } = await supabase
          .from("tracked_accounts")
          .select("id, username")
          .in("id", accountIds);
        for (const a of accts ?? []) accountLabels.set(a.id, `@${a.username}`);
      }
      if (locationIds.length) {
        const { data: locs } = await supabase
          .from("tracked_locations")
          .select("id, name")
          .in("id", locationIds);
        for (const l of locs ?? []) locationLabels.set(l.id, `📍 ${l.name}`);
      }
      signalsByCandidate = new Map();
      for (const s of sigs ?? []) {
        const label =
          (s.seed_account_id && accountLabels.get(s.seed_account_id)) ??
          (s.seed_location_id && locationLabels.get(s.seed_location_id)) ??
          (s.seed_hashtag ? `#${s.seed_hashtag}` : null);
        const arr = signalsByCandidate.get(s.candidate_id) ?? [];
        arr.push({
          source_type: s.source_type,
          seed_account_id: s.seed_account_id,
          seed_location_id: s.seed_location_id,
          seed_hashtag: s.seed_hashtag,
          weight: Number(s.weight ?? 1),
          created_at: s.created_at,
          seed_label: label,
        });
        signalsByCandidate.set(s.candidate_id, arr);
      }
    }

    // Build "Discovered via" chains — walk parent_candidate_id up to 3 hops,
    // then resolve the origin tracked account (created_by = userId).
    const rowsSafe = rows ?? [];
    const knownById = new Map<string, { id: string; username: string; parent_candidate_id: string | null }>();
    for (const r of rowsSafe) {
      knownById.set(r.id, {
        id: r.id,
        username: r.username,
        parent_candidate_id: r.parent_candidate_id ?? null,
      });
    }
    // Load ancestors up to 3 hops beyond the loaded rows.
    for (let hop = 0; hop < 3; hop++) {
      const missing = new Set<string>();
      for (const v of knownById.values()) {
        if (v.parent_candidate_id && !knownById.has(v.parent_candidate_id)) {
          missing.add(v.parent_candidate_id);
        }
      }
      if (!missing.size) break;
      const { data: parents } = await supabase
        .from("discovery_candidates")
        .select("id, username, parent_candidate_id")
        .eq("user_id", userId)
        .in("id", [...missing]);
      for (const p of parents ?? []) {
        knownById.set(p.id, {
          id: p.id,
          username: p.username,
          parent_candidate_id: p.parent_candidate_id ?? null,
        });
      }
      if (!parents?.length) break;
    }

    // Resolve origin tracked accounts for the chain roots.
    const rootParentUsernames = new Set<string>();
    for (const v of knownById.values()) {
      if (v.parent_candidate_id === null) rootParentUsernames.add(v.username);
    }
    const originByUsername = new Map<string, string>();
    if (rootParentUsernames.size) {
      const { data: origins } = await supabase
        .from("tracked_accounts")
        .select("username, origin_candidate_id")
        .eq("created_by", userId)
        .is("origin_candidate_id", null)
        .in("username", [...rootParentUsernames]);
      for (const o of origins ?? []) originByUsername.set(o.username, o.username);
    }

    function chainFor(id: string): DiscoveredViaHop[] {
      const chain: DiscoveredViaHop[] = [];
      const seen = new Set<string>();
      let cur = knownById.get(id);
      // walk parents (exclude self)
      while (cur?.parent_candidate_id) {
        if (seen.has(cur.parent_candidate_id)) break;
        seen.add(cur.parent_candidate_id);
        const parent = knownById.get(cur.parent_candidate_id);
        if (!parent) break;
        chain.push({ id: parent.id, username: parent.username, kind: "candidate" });
        cur = parent;
        if (chain.length >= 3) break;
      }
      // If the topmost candidate corresponds to a manually-tracked account, tag it as origin.
      if (chain.length) {
        const top = chain[chain.length - 1];
        if (originByUsername.has(top.username)) {
          chain[chain.length - 1] = { ...top, kind: "origin" };
        }
      }
      // Return in root → leaf order.
      return chain.reverse();
    }

    return rowsSafe.map((r) => {
      const sigs = signalsByCandidate.get(r.id) ?? [];
      return {
        ...r,
        score_reasons: (r.score_reasons ?? {}) as ScoreReasons,
        headline_signals: buildHeadlineSignals(r, sigs),
        discovered_via: chainFor(r.id),
        signals: sigs.slice(0, 6),
      };
    }) as DiscoveryCandidateRow[];
  });


function buildHeadlineSignals(
  r: {
    luxury_score: number | null;
    quality_score: number | null;
    aesthetic_score: number | null;
    travel_score: number | null;
    authenticity_score: number | null;
    estimated_niche: string | null;
    estimated_post_frequency: string | null;
  },
  sigs: Array<{
    source_type: string;
    seed_account_id: string | null;
    seed_location_id: string | null;
    seed_hashtag: string | null;
    seed_label: string | null;
  }>,
): string[] {
  const accountCounts = new Map<string, { label: string; count: number }>();
  const locationCounts = new Map<string, { label: string; count: number }>();
  const taggedBy = new Set<string>();
  const collabWith = new Set<string>();

  for (const s of sigs) {
    if (s.seed_account_id) {
      const cur = accountCounts.get(s.seed_account_id) ?? {
        label: s.seed_label ?? "tracked account",
        count: 0,
      };
      cur.count += 1;
      accountCounts.set(s.seed_account_id, cur);
      if (s.source_type === "tagged_user" || s.source_type === "tagged_collaborator") {
        taggedBy.add(s.seed_account_id);
      }
      if (s.source_type === "tagged_collaborator") collabWith.add(s.seed_account_id);
    }
    if (s.seed_location_id) {
      const cur = locationCounts.get(s.seed_location_id) ?? {
        label: s.seed_label ?? "tracked location",
        count: 0,
      };
      cur.count += 1;
      locationCounts.set(s.seed_location_id, cur);
    }
  }

  const topAccounts = [...accountCounts.values()].sort((a, b) => b.count - a.count);
  const topLocations = [...locationCounts.values()].sort((a, b) => b.count - a.count);

  const lines: string[] = [];

  if (topAccounts[0]) {
    const t = topAccounts[0];
    lines.push(
      t.count >= 2 ? `Appeared with ${t.label} ${t.count} times` : `Appeared with ${t.label}`,
    );
  }
  if (topLocations[0]) {
    const t = topLocations[0];
    lines.push(
      t.count >= 2 ? `Posted from ${t.label} ${t.count} times` : `Posted from ${t.label}`,
    );
  }
  if (taggedBy.size >= 2) {
    lines.push(`Tagged by ${taggedBy.size} tracked accounts`);
  }
  if (collabWith.size >= 1 && !lines.some((l) => l.startsWith("Tagged by"))) {
    lines.push(`Collaborated with ${collabWith.size} tracked account${collabWith.size === 1 ? "" : "s"}`);
  }
  if (topAccounts.length >= 2 && topAccounts.length > taggedBy.size) {
    const overlap = topAccounts.length;
    if (!lines.some((l) => l.startsWith("Tagged by") || l.startsWith("Collaborated"))) {
      lines.push(`Signals from ${overlap} tracked accounts`);
    }
  }

  const strongScores: Array<[string, number | null]> = [
    ["Luxury", r.luxury_score],
    ["Aesthetic", r.aesthetic_score],
    ["Quality", r.quality_score],
    ["Travel", r.travel_score],
  ];
  const strong = strongScores.filter(([, v]) => typeof v === "number" && (v as number) >= 85);
  if (strong.length) {
    lines.push(
      strong
        .slice(0, 2)
        .map(([k, v]) => `${k} score ${v}`)
        .join(" · "),
    );
  }

  if (r.estimated_niche && lines.length < 5) {
    lines.push(
      r.estimated_post_frequency
        ? `${r.estimated_niche} · ${r.estimated_post_frequency}`
        : r.estimated_niche,
    );
  }

  return lines.slice(0, 5);
}

export const getDiscoveryStatsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [nu, tr, ig, bl, avg] = await Promise.all([
      supabase.from("discovery_candidates").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("state", "new"),
      supabase.from("discovery_candidates").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("state", "tracked"),
      supabase.from("discovery_candidates").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("state", "ignored"),
      supabase.from("discovery_candidates").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("state", "blacklisted"),
      supabase.from("discovery_candidates").select("confidence").eq("user_id", userId).eq("state", "new"),
    ]);
    const confidences = (avg.data ?? []).map((r) => Number(r.confidence ?? 0));
    const avgConfidence = confidences.length
      ? confidences.reduce((s, v) => s + v, 0) / confidences.length
      : 0;
    return {
      new_count: nu.count ?? 0,
      tracked_count: tr.count ?? 0,
      ignored_count: ig.count ?? 0,
      blacklisted_count: bl.count ?? 0,
      avg_confidence: avgConfidence,
    };
  });

export const decideDiscoveryCandidateFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string; decision: "track" | "ignore" | "blacklist" }) =>
    z
      .object({
        id: z.string().uuid(),
        decision: z.enum(["track", "ignore", "blacklist"]),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { applyOperatorDecision } = await import("@/lib/discovery-service.server");
    return applyOperatorDecision(context.supabase, data.id, data.decision);
  });

export const runDiscoveryNowFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { limit?: number } | undefined) =>
    z.object({ limit: z.number().min(1).max(20).optional() }).parse(data ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const limit = data.limit ?? 8;

    // Seed for THIS operator's tracked accounts + locations
    const { data: accounts } = await supabase
      .from("tracked_accounts")
      .select("id")
      .eq("created_by", userId)
      .eq("status", "active")
      .order("last_discovery_at", { ascending: true, nullsFirst: true })
      .limit(limit);
    const { data: locations } = await supabase
      .from("tracked_locations")
      .select("id")
      .eq("created_by", userId)
      .eq("status", "active")
      .order("last_discovery_at", { ascending: true, nullsFirst: true })
      .limit(limit);

    const {
      runDiscoveryForSeedAccount,
      runDiscoveryForSeedLocation,
      enrichPendingCandidates,
    } = await import("@/lib/discovery-service.server");

    let seeded = 0;
    for (const a of accounts ?? []) {
      const r = await runDiscoveryForSeedAccount(supabase, a.id);
      seeded += r.candidates;
    }
    for (const l of locations ?? []) {
      const r = await runDiscoveryForSeedLocation(supabase, l.id);
      seeded += r.candidates;
    }
    const enrichment = await enrichPendingCandidates(supabase, userId, 5);

    return {
      seeded_candidates: seeded,
      accounts_scanned: (accounts ?? []).length,
      locations_scanned: (locations ?? []).length,
      enriched: enrichment.enriched,
    };
  });

export const enrichDiscoveryCandidateFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) =>
    z.object({ id: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { enrichCandidate } = await import("@/lib/discovery-service.server");
    return enrichCandidate(context.supabase, data.id);
  });
