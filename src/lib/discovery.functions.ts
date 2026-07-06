/**
 * Discovery Engine — server functions.
 * All handlers scope to the authenticated operator via requireSupabaseAuth.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DISCOVERY_WEIGHTS } from "@/lib/discovery-weights";

export type ScoreReasons = Partial<
  Record<"luxury" | "quality" | "aesthetic" | "travel" | "authenticity", string[]>
>;

export type DiscoveredViaHop = {
  id: string;
  username: string;
  kind: "candidate" | "origin";
};

export type ClusterPeer = {
  id: string;
  username: string;
  avatar_url: string | null;
  count: number;
  is_representative: boolean;
};

export type RankBreakdown = {
  base: number;
  learning: number;
  diversity: number;
  novelty: number;
  final: number;
  entropy_floor: number;
  passes_entropy: boolean;
  novelty_detail: { tracked_peers: number; total_peers: number };
  diversity_detail: { niche_repeats: number; cluster_repeats: number };
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
  cluster_peers: ClusterPeer[];
  is_cluster_representative: boolean;
  cluster_size: number;
  rank_breakdown: RankBreakdown;


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

    // Cluster detection — group candidates that repeatedly co-appear.
    const CLUSTER_MIN = 2;
    const rowIds = rowsSafe.map((r) => r.id);
    const peersByCandidate = new Map<
      string,
      Array<{ id: string; count: number }>
    >();
    for (const id of rowIds) peersByCandidate.set(id, []);
    if (rowIds.length) {
      const { data: cooc } = await supabase
        .from("discovery_cooccurrences")
        .select("a_id, b_id, count")
        .eq("user_id", userId)
        .gte("count", CLUSTER_MIN)
        .or(
          `a_id.in.(${rowIds.join(",")}),b_id.in.(${rowIds.join(",")})`,
        );
      for (const e of cooc ?? []) {
        const cnt = e.count ?? 0;
        if (cnt < CLUSTER_MIN) continue;
        if (peersByCandidate.has(e.a_id))
          peersByCandidate.get(e.a_id)!.push({ id: e.b_id, count: cnt });
        if (peersByCandidate.has(e.b_id))
          peersByCandidate.get(e.b_id)!.push({ id: e.a_id, count: cnt });
      }
    }

    // Union-find over candidates that appear in each other's peer list
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      const p = parent.get(x) ?? x;
      if (p === x) return x;
      const r = find(p);
      parent.set(x, r);
      return r;
    };
    const union = (x: string, y: string) => {
      const rx = find(x);
      const ry = find(y);
      if (rx !== ry) parent.set(rx, ry);
    };
    for (const id of rowIds) parent.set(id, id);
    for (const [id, peers] of peersByCandidate) {
      for (const p of peers) if (peersByCandidate.has(p.id)) union(id, p.id);
    }

    // For each cluster, pick a representative = highest rank_score.
    const rowById = new Map(rowsSafe.map((r) => [r.id, r]));
    const clusters = new Map<string, string[]>();
    for (const id of rowIds) {
      const root = find(id);
      const arr = clusters.get(root) ?? [];
      arr.push(id);
      clusters.set(root, arr);
    }
    const representativeIds = new Set<string>();
    const clusterSizeById = new Map<string, number>();
    for (const [, members] of clusters) {
      if (members.length <= 1) {
        clusterSizeById.set(members[0], 1);
        continue;
      }
      const rep = members
        .map((id) => rowById.get(id))
        .filter((r): r is NonNullable<typeof r> => Boolean(r))
        .sort((a, b) => Number(b.rank_score ?? 0) - Number(a.rank_score ?? 0))[0];
      if (rep) representativeIds.add(rep.id);
      for (const m of members) clusterSizeById.set(m, members.length);
    }

    // Phase 4 — transparent ranking modifiers.
    // Load prefs + tracked usernames + total tracked count so learning /
    // novelty / entropy can be computed live per candidate.
    const [{ data: prefsRow }, { data: trackedRows, count: trackedCount }] =
      await Promise.all([
        supabase
          .from("discovery_preferences")
          .select("*")
          .eq("user_id", userId)
          .maybeSingle(),
        supabase
          .from("tracked_accounts")
          .select("username", { count: "exact" })
          .eq("created_by", userId)
          .eq("status", "active"),
      ]);
    const trackedUsernames = new Set(
      (trackedRows ?? []).map((r) => r.username.toLowerCase()),
    );
    const nicheWeights = (prefsRow?.niche_weights ?? {}) as Record<string, number>;
    const entropyFloor = Math.min(
      DISCOVERY_WEIGHTS.ENTROPY_CEIL,
      DISCOVERY_WEIGHTS.ENTROPY_BASE +
        DISCOVERY_WEIGHTS.ENTROPY_PER_TRACKED * (trackedCount ?? 0),
    );

    // Cluster root per candidate — for diversity de-duplication across niches.
    const rootIdByCandidate = new Map<string, string>();
    for (const id of rowIds) rootIdByCandidate.set(id, find(id));

    // First pass: compute base, learning, novelty per candidate.
    type Interim = {
      row: (typeof rowsSafe)[number];
      peers: ClusterPeer[];
      sigs: DiscoveryCandidateRow["signals"];
      base: number;
      learning: number;
      novelty: number;
      novelty_detail: { tracked_peers: number; total_peers: number };
    };
    const interim: Interim[] = rowsSafe.map((r) => {
      const sigs = signalsByCandidate.get(r.id) ?? [];
      const peers = (peersByCandidate.get(r.id) ?? [])
        .sort((a, b) => b.count - a.count)
        .slice(0, 8)
        .map<ClusterPeer>((p) => {
          const peer = rowById.get(p.id);
          return {
            id: p.id,
            username: peer?.username ?? "",
            avatar_url: peer?.avatar_url ?? null,
            count: p.count,
            is_representative: representativeIds.has(p.id),
          };
        })
        .filter((p) => p.username.length > 0);

      const base = Number(r.rank_score ?? 0);

      // Learning boost = how much niche_weights lifted this candidate's base.
      // Base already bakes it in via computeRankScore's nicheMatch term
      // (0.35 * min(1, weight/3)) with a floor of 0.3 when the niche is
      // unknown. We back out that contribution vs the neutral 0.3.
      let learning = 0;
      if (r.estimated_niche) {
        const w = nicheWeights[r.estimated_niche.toLowerCase()] ?? 0;
        const currentMatch = w > 0 ? Math.min(1, w / 3) : 0.3;
        const negativePenalty = w < 0 ? Math.max(-1, w / 3) * 0.35 : 0;
        learning = 0.35 * (currentMatch - 0.3) + negativePenalty;
      }

      // Novelty — reward candidates whose peers are NOT already tracked.
      const totalPeers = peers.length;
      const trackedPeers = peers.filter((p) =>
        trackedUsernames.has(p.username.toLowerCase()),
      ).length;
      const novelty =
        totalPeers === 0
          ? DISCOVERY_WEIGHTS.NOVELTY_NEUTRAL
          : DISCOVERY_WEIGHTS.NOVELTY_MAX * (1 - trackedPeers / totalPeers);

      return {
        row: r,
        peers,
        sigs,
        base,
        learning,
        novelty,
        novelty_detail: { tracked_peers: trackedPeers, total_peers: totalPeers },
      };
    });

    // Preliminary composite (before diversity) drives the walk order.
    interim.sort(
      (a, b) => b.base + b.learning + b.novelty - (a.base + a.learning + a.novelty),
    );

    // Second pass: apply diversity penalty top→bottom.
    const seenNiches = new Map<string, number>();
    const seenClusters = new Map<string, number>();
    const withBreakdown = interim.map((it) => {
      const niche = it.row.estimated_niche?.toLowerCase() ?? null;
      const cluster = rootIdByCandidate.get(it.row.id) ?? it.row.id;
      const nicheRepeats = niche ? (seenNiches.get(niche) ?? 0) : 0;
      const clusterRepeats = seenClusters.get(cluster) ?? 0;
      const repeats = nicheRepeats + clusterRepeats;
      const diversity = Math.min(
        DISCOVERY_WEIGHTS.DIVERSITY_MAX,
        DISCOVERY_WEIGHTS.DIVERSITY_STEP * repeats,
      );
      if (niche) seenNiches.set(niche, nicheRepeats + 1);
      seenClusters.set(cluster, clusterRepeats + 1);

      const final = it.base + it.learning + it.novelty - diversity;
      const breakdown: RankBreakdown = {
        base: it.base,
        learning: it.learning,
        diversity: -diversity,
        novelty: it.novelty,
        final,
        entropy_floor: entropyFloor,
        passes_entropy: final >= entropyFloor,
        novelty_detail: it.novelty_detail,
        diversity_detail: {
          niche_repeats: nicheRepeats,
          cluster_repeats: clusterRepeats,
        },
      };
      return { it, breakdown, final };
    });

    // Final sort by composite score.
    withBreakdown.sort((a, b) => b.final - a.final);

    return withBreakdown.map(({ it, breakdown }) => {
      const r = it.row;
      return {
        ...r,
        score_reasons: (r.score_reasons ?? {}) as ScoreReasons,
        headline_signals: buildHeadlineSignals(r, it.sigs),
        discovered_via: chainFor(r.id),
        cluster_peers: it.peers,
        is_cluster_representative:
          representativeIds.has(r.id) || (clusterSizeById.get(r.id) ?? 1) <= 1,
        cluster_size: clusterSizeById.get(r.id) ?? 1,
        rank_breakdown: breakdown,
        signals: it.sigs.slice(0, 6),
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

/**
 * Discovery quality debug — per-seed candidate counts + enrichment tallies.
 * Client computes top-10 / entropy-hidden from the already-ranked list; this
 * fills in the bits the list can't answer (per-seed provenance, enrichment).
 */
export type DiscoveryDebugSeed = {
  seed_id: string;
  kind: "account" | "location";
  label: string;
  candidate_count: number;
};

export type DiscoveryDebugData = {
  seeds: DiscoveryDebugSeed[];
  total_candidates: number;
  enriched: number;
  unenriched: number;
  new_state: number;
};

export const getDiscoveryDebugFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DiscoveryDebugData> => {
    const { supabase, userId } = context;

    const [{ data: cands }, { data: sigs }, { data: accts }, { data: locs }] =
      await Promise.all([
        supabase
          .from("discovery_candidates")
          .select("id, state, last_ai_at")
          .eq("user_id", userId),
        supabase
          .from("discovery_signals")
          .select("candidate_id, seed_account_id, seed_location_id")
          .eq("user_id", userId),
        supabase
          .from("tracked_accounts")
          .select("id, username")
          .eq("created_by", userId)
          .eq("status", "active"),
        supabase
          .from("tracked_locations")
          .select("id, name")
          .eq("created_by", userId)
          .eq("status", "active"),
      ]);

    const total = cands?.length ?? 0;
    const enriched = (cands ?? []).filter((c) => c.last_ai_at).length;
    const newState = (cands ?? []).filter((c) => c.state === "new").length;

    const perAcct = new Map<string, Set<string>>();
    const perLoc = new Map<string, Set<string>>();
    for (const s of sigs ?? []) {
      if (s.seed_account_id) {
        const set = perAcct.get(s.seed_account_id) ?? new Set<string>();
        set.add(s.candidate_id);
        perAcct.set(s.seed_account_id, set);
      }
      if (s.seed_location_id) {
        const set = perLoc.get(s.seed_location_id) ?? new Set<string>();
        set.add(s.candidate_id);
        perLoc.set(s.seed_location_id, set);
      }
    }

    const seeds: DiscoveryDebugSeed[] = [
      ...(accts ?? []).map((a) => ({
        seed_id: a.id,
        kind: "account" as const,
        label: `@${a.username}`,
        candidate_count: perAcct.get(a.id)?.size ?? 0,
      })),
      ...(locs ?? []).map((l) => ({
        seed_id: l.id,
        kind: "location" as const,
        label: `📍 ${l.name}`,
        candidate_count: perLoc.get(l.id)?.size ?? 0,
      })),
    ].sort((a, b) => b.candidate_count - a.candidate_count);

    return {
      seeds,
      total_candidates: total,
      enriched,
      unenriched: total - enriched,
      new_state: newState,
    };
  });

/**
 * Discovery Analytics — measure whether Discovery is becoming smarter over
 * time. All aggregates are scoped to the authenticated operator. Cross-
 * operator divergence is only included if the caller has the operator role
 * (owner / cofounder), which is checked via the `is_operator` RPC.
 *
 * The engine itself is the product here — treat this like an ML dashboard.
 */

const AXES = ["luxury", "quality", "aesthetic", "travel", "authenticity"] as const;
type Axis = (typeof AXES)[number];

export type SourceMetric = {
  source_type: string;
  candidates: number;
  tracked: number;
  ignored: number;
  blacklisted: number;
  pending: number;
  track_rate: number;
  reject_rate: number;
};

export type SeedMetric = {
  seed_id: string;
  kind: "account" | "location" | "hashtag";
  label: string;
  candidates: number;
  tracked: number;
  ignored: number;
  blacklisted: number;
  track_rate: number;
  reject_rate: number;
  avg_tracked_quality: number | null;
  hidden_gem_score: number;
};

export type BranchMetric = {
  parent_id: string;
  parent_username: string;
  parent_state: string;
  children: number;
  tracked: number;
  rejected: number;
  reject_rate: number;
  track_rate: number;
};

export type AxisCorrelation = {
  axis: Axis;
  mean_tracked: number | null;
  mean_rejected: number | null;
  gap: number | null;
  n_tracked: number;
  n_rejected: number;
  point_biserial: number | null;
};

export type NicheMetric = {
  niche: string;
  candidates: number;
  tracked: number;
  reject_rate: number;
  track_rate: number;
  avg_tracked_quality: number | null;
};

export type OperatorDivergence = {
  available: boolean;
  operators: Array<{ user_id: string; display_name: string | null; sample_size: number }>;
  pairs: Array<{
    a_user_id: string;
    b_user_id: string;
    a_label: string;
    b_label: string;
    cosine: number;
    divergence: number; // 1 - cosine
    top_disagreement: Array<{ niche: string; a_weight: number; b_weight: number }>;
  }>;
};

export type DiscoveryAnalyticsData = {
  overview: {
    total_candidates: number;
    tracked: number;
    ignored: number;
    blacklisted: number;
    pending: number;
    decisions: number;
    track_rate: number;
    reject_rate: number;
    enriched: number;
    unenriched: number;
    sample_size: number;
  };
  by_source: SourceMetric[];
  by_seed: SeedMetric[];
  by_branch: {
    high_yield: BranchMetric[];
    low_yield: BranchMetric[];
  };
  score_correlation: AxisCorrelation[];
  by_niche: NicheMetric[];
  divergence: OperatorDivergence;
};

function mean(xs: number[]): number | null {
  if (!xs.length) return null;
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}

// Point-biserial correlation between a continuous score and a binary label.
// group = 1 for tracked, 0 for rejected (ignored + blacklisted).
function pointBiserial(scores: number[], groups: number[]): number | null {
  if (scores.length < 3) return null;
  const n = scores.length;
  const m = scores.reduce((s, v) => s + v, 0) / n;
  const variance = scores.reduce((s, v) => s + (v - m) ** 2, 0) / n;
  const sd = Math.sqrt(variance);
  if (sd === 0) return null;
  const idx1: number[] = [];
  const idx0: number[] = [];
  for (let i = 0; i < n; i++) (groups[i] === 1 ? idx1 : idx0).push(scores[i]);
  if (!idx1.length || !idx0.length) return null;
  const m1 = idx1.reduce((s, v) => s + v, 0) / idx1.length;
  const m0 = idx0.reduce((s, v) => s + v, 0) / idx0.length;
  const p = idx1.length / n;
  const q = idx0.length / n;
  return ((m1 - m0) / sd) * Math.sqrt(p * q);
}

function cosine(a: Record<string, number>, b: Record<string, number>): number {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const k of keys) {
    const va = a[k] ?? 0;
    const vb = b[k] ?? 0;
    dot += va * vb;
    na += va * va;
    nb += vb * vb;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export const getDiscoveryAnalyticsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DiscoveryAnalyticsData> => {
    const { supabase, userId } = context;

    const [
      { data: cands },
      { data: sigs },
      { data: accts },
      { data: locs },
      { data: prefs },
    ] = await Promise.all([
      supabase
        .from("discovery_candidates")
        .select(
          "id, username, state, estimated_niche, luxury_score, quality_score, aesthetic_score, travel_score, authenticity_score, parent_candidate_id, last_ai_at",
        )
        .eq("user_id", userId),
      supabase
        .from("discovery_signals")
        .select("candidate_id, source_type, seed_account_id, seed_location_id, seed_hashtag")
        .eq("user_id", userId),
      supabase
        .from("tracked_accounts")
        .select("id, username")
        .eq("created_by", userId),
      supabase
        .from("tracked_locations")
        .select("id, name")
        .eq("created_by", userId),
      supabase
        .from("discovery_preferences")
        .select("sample_size, niche_weights")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);

    const candidates = cands ?? [];
    const signals = sigs ?? [];
    const candById = new Map(candidates.map((c) => [c.id, c]));
    const acctLabel = new Map((accts ?? []).map((a) => [a.id, `@${a.username}`]));
    const locLabel = new Map((locs ?? []).map((l) => [l.id, `📍 ${l.name}`]));

    // Overview.
    let tracked = 0;
    let ignored = 0;
    let blacklisted = 0;
    let pending = 0;
    let enriched = 0;
    for (const c of candidates) {
      if (c.state === "tracked") tracked += 1;
      else if (c.state === "ignored") ignored += 1;
      else if (c.state === "blacklisted") blacklisted += 1;
      else pending += 1;
      if (c.last_ai_at) enriched += 1;
    }
    const decisions = tracked + ignored + blacklisted;
    const rejected = ignored + blacklisted;

    // ---- by source_type ----
    // A candidate can have many signals; count each (candidate, source) pair once.
    const sourceSets = new Map<string, Set<string>>();
    for (const s of signals) {
      const set = sourceSets.get(s.source_type) ?? new Set<string>();
      set.add(s.candidate_id);
      sourceSets.set(s.source_type, set);
    }
    const by_source: SourceMetric[] = [];
    for (const [src, set] of sourceSets) {
      let t = 0;
      let i = 0;
      let b = 0;
      let p = 0;
      for (const id of set) {
        const c = candById.get(id);
        if (!c) continue;
        if (c.state === "tracked") t += 1;
        else if (c.state === "ignored") i += 1;
        else if (c.state === "blacklisted") b += 1;
        else p += 1;
      }
      const d = t + i + b;
      by_source.push({
        source_type: src,
        candidates: set.size,
        tracked: t,
        ignored: i,
        blacklisted: b,
        pending: p,
        track_rate: d ? t / d : 0,
        reject_rate: d ? (i + b) / d : 0,
      });
    }
    by_source.sort((a, b) => b.track_rate - a.track_rate || b.candidates - a.candidates);

    // ---- by seed (root sources) ----
    type Bucket = {
      seed_id: string;
      kind: "account" | "location" | "hashtag";
      label: string;
      ids: Set<string>;
    };
    const buckets = new Map<string, Bucket>();
    const bucketFor = (
      key: string,
      kind: "account" | "location" | "hashtag",
      label: string,
    ) => {
      let b = buckets.get(key);
      if (!b) {
        b = { seed_id: key, kind, label, ids: new Set() };
        buckets.set(key, b);
      }
      return b;
    };
    for (const s of signals) {
      if (s.seed_account_id) {
        bucketFor(
          `a:${s.seed_account_id}`,
          "account",
          acctLabel.get(s.seed_account_id) ?? "tracked account",
        ).ids.add(s.candidate_id);
      } else if (s.seed_location_id) {
        bucketFor(
          `l:${s.seed_location_id}`,
          "location",
          locLabel.get(s.seed_location_id) ?? "tracked location",
        ).ids.add(s.candidate_id);
      } else if (s.seed_hashtag) {
        bucketFor(`h:${s.seed_hashtag}`, "hashtag", `#${s.seed_hashtag}`).ids.add(
          s.candidate_id,
        );
      }
    }
    const avgAxes = (c: (typeof candidates)[number]) => {
      const vals = AXES.map((a) => c[`${a}_score` as const]).filter(
        (v): v is number => typeof v === "number",
      );
      return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
    };
    const by_seed: SeedMetric[] = [];
    for (const b of buckets.values()) {
      let t = 0;
      let i = 0;
      let bl = 0;
      const trackedQualities: number[] = [];
      for (const id of b.ids) {
        const c = candById.get(id);
        if (!c) continue;
        if (c.state === "tracked") {
          t += 1;
          const q = avgAxes(c);
          if (q !== null) trackedQualities.push(q);
        } else if (c.state === "ignored") i += 1;
        else if (c.state === "blacklisted") bl += 1;
      }
      const d = t + i + bl;
      const avgQ = mean(trackedQualities);
      // hidden gem score = track rate × avg quality of tracked, scaled to 0-100.
      // Rewards seeds that produce FEWER but HIGHER quality picks.
      const track_rate = d ? t / d : 0;
      const hidden_gem_score = avgQ !== null ? track_rate * avgQ : 0;
      by_seed.push({
        seed_id: b.seed_id,
        kind: b.kind,
        label: b.label,
        candidates: b.ids.size,
        tracked: t,
        ignored: i,
        blacklisted: bl,
        track_rate,
        reject_rate: d ? (i + bl) / d : 0,
        avg_tracked_quality: avgQ,
        hidden_gem_score,
      });
    }
    by_seed.sort((a, b) => b.hidden_gem_score - a.hidden_gem_score);

    // ---- branches (parent candidate → children) ----
    const branchMap = new Map<string, BranchMetric>();
    for (const c of candidates) {
      const pid = c.parent_candidate_id;
      if (!pid) continue;
      const parent = candById.get(pid);
      if (!parent) continue;
      let bm = branchMap.get(pid);
      if (!bm) {
        bm = {
          parent_id: pid,
          parent_username: parent.username,
          parent_state: parent.state,
          children: 0,
          tracked: 0,
          rejected: 0,
          reject_rate: 0,
          track_rate: 0,
        };
        branchMap.set(pid, bm);
      }
      bm.children += 1;
      if (c.state === "tracked") bm.tracked += 1;
      else if (c.state === "ignored" || c.state === "blacklisted") bm.rejected += 1;
    }
    for (const bm of branchMap.values()) {
      const d = bm.tracked + bm.rejected;
      bm.track_rate = d ? bm.tracked / d : 0;
      bm.reject_rate = d ? bm.rejected / d : 0;
    }
    const branches = [...branchMap.values()].filter((b) => b.tracked + b.rejected >= 2);
    const high_yield = [...branches].sort(
      (a, b) => b.track_rate - a.track_rate || b.tracked - a.tracked,
    ).slice(0, 10);
    const low_yield = [...branches].sort(
      (a, b) => b.reject_rate - a.reject_rate || b.rejected - a.rejected,
    ).slice(0, 10);

    // ---- AI score correlation with Track ----
    const score_correlation: AxisCorrelation[] = [];
    for (const axis of AXES) {
      const col = `${axis}_score` as const;
      const tScores: number[] = [];
      const rScores: number[] = [];
      const allScores: number[] = [];
      const groups: number[] = [];
      for (const c of candidates) {
        const v = c[col];
        if (typeof v !== "number") continue;
        if (c.state === "tracked") {
          tScores.push(v);
          allScores.push(v);
          groups.push(1);
        } else if (c.state === "ignored" || c.state === "blacklisted") {
          rScores.push(v);
          allScores.push(v);
          groups.push(0);
        }
      }
      const mt = mean(tScores);
      const mr = mean(rScores);
      score_correlation.push({
        axis,
        mean_tracked: mt,
        mean_rejected: mr,
        gap: mt !== null && mr !== null ? mt - mr : null,
        n_tracked: tScores.length,
        n_rejected: rScores.length,
        point_biserial: pointBiserial(allScores, groups),
      });
    }
    score_correlation.sort(
      (a, b) => Math.abs(b.point_biserial ?? 0) - Math.abs(a.point_biserial ?? 0),
    );

    // ---- by niche ----
    const nicheMap = new Map<
      string,
      { total: number; tracked: number; rejected: number; qualities: number[] }
    >();
    for (const c of candidates) {
      const n = (c.estimated_niche ?? "").toLowerCase().trim();
      if (!n) continue;
      let e = nicheMap.get(n);
      if (!e) {
        e = { total: 0, tracked: 0, rejected: 0, qualities: [] };
        nicheMap.set(n, e);
      }
      e.total += 1;
      if (c.state === "tracked") {
        e.tracked += 1;
        const q = avgAxes(c);
        if (q !== null) e.qualities.push(q);
      } else if (c.state === "ignored" || c.state === "blacklisted") {
        e.rejected += 1;
      }
    }
    const by_niche: NicheMetric[] = [];
    for (const [niche, e] of nicheMap) {
      const d = e.tracked + e.rejected;
      by_niche.push({
        niche,
        candidates: e.total,
        tracked: e.tracked,
        track_rate: d ? e.tracked / d : 0,
        reject_rate: d ? e.rejected / d : 0,
        avg_tracked_quality: mean(e.qualities),
      });
    }
    by_niche.sort((a, b) => b.track_rate - a.track_rate || b.candidates - a.candidates);

    // ---- operator divergence (opt-in, operator role only) ----
    const divergence: OperatorDivergence = { available: false, operators: [], pairs: [] };
    try {
      const { data: isOp } = await supabase.rpc("is_operator", { _user_id: userId });
      if (isOp) {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: allPrefs } = await supabaseAdmin
          .from("discovery_preferences")
          .select("user_id, sample_size, niche_weights");
        const { data: profiles } = await supabaseAdmin
          .from("profiles")
          .select("id, display_name, email");
        const nameById = new Map(
          (profiles ?? []).map((p) => [
            p.id,
            p.display_name ?? p.email ?? p.id.slice(0, 6),
          ]),
        );
        const active = (allPrefs ?? []).filter((p) => (p.sample_size ?? 0) >= 3);
        divergence.available = true;
        divergence.operators = active.map((p) => ({
          user_id: p.user_id,
          display_name: nameById.get(p.user_id) ?? null,
          sample_size: p.sample_size ?? 0,
        }));
        for (let a = 0; a < active.length; a++) {
          for (let b = a + 1; b < active.length; b++) {
            const A = active[a];
            const B = active[b];
            const aw = (A.niche_weights ?? {}) as Record<string, number>;
            const bw = (B.niche_weights ?? {}) as Record<string, number>;
            const cos = cosine(aw, bw);
            const keys = new Set([...Object.keys(aw), ...Object.keys(bw)]);
            const disagreements = [...keys]
              .map((k) => ({
                niche: k,
                a_weight: aw[k] ?? 0,
                b_weight: bw[k] ?? 0,
                delta: Math.abs((aw[k] ?? 0) - (bw[k] ?? 0)),
              }))
              .sort((x, y) => y.delta - x.delta)
              .slice(0, 5)
              .map(({ niche, a_weight, b_weight }) => ({ niche, a_weight, b_weight }));
            divergence.pairs.push({
              a_user_id: A.user_id,
              b_user_id: B.user_id,
              a_label: nameById.get(A.user_id) ?? A.user_id.slice(0, 6),
              b_label: nameById.get(B.user_id) ?? B.user_id.slice(0, 6),
              cosine: cos,
              divergence: 1 - cos,
              top_disagreement: disagreements,
            });
          }
        }
        divergence.pairs.sort((a, b) => b.divergence - a.divergence);
      }
    } catch (err) {
      console.warn("[discovery-analytics] divergence unavailable", err);
    }

    return {
      overview: {
        total_candidates: candidates.length,
        tracked,
        ignored,
        blacklisted,
        pending,
        decisions,
        track_rate: decisions ? tracked / decisions : 0,
        reject_rate: decisions ? rejected / decisions : 0,
        enriched,
        unenriched: candidates.length - enriched,
        sample_size: prefs?.sample_size ?? 0,
      },
      by_source,
      by_seed,
      by_branch: { high_yield, low_yield },
      score_correlation,
      by_niche,
      divergence,
    };
  });
