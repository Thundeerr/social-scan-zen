/**
 * Discovery Engine — server functions.
 * All handlers scope to the authenticated operator via requireSupabaseAuth.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
  p_private_individual: number | null;
  p_commercial_brand: number | null;
  estimated_post_frequency: string | null;
  confidence: number;
  rank_score: number;
  state: "new" | "tracked" | "ignored" | "blacklisted";
  signal_count: number;
  first_seen_at: string;
  last_seen_at: string;
  last_ai_at: string | null;
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

    return (rows ?? []).map((r) => ({
      ...r,
      signals: signalsByCandidate.get(r.id)?.slice(0, 6) ?? [],
    })) as DiscoveryCandidateRow[];
  });

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
