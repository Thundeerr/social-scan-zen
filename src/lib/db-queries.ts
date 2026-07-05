import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

// ---------- Tracked accounts ----------
export type TrackedAccount = Tables<"tracked_accounts">;
export type TrackedAccountInsert = TablesInsert<"tracked_accounts">;
export type TrackedAccountUpdate = TablesUpdate<"tracked_accounts">;

export const trackedAccountsKey = ["tracked_accounts"] as const;

export function useTrackedAccounts() {
  return useQuery({
    queryKey: trackedAccountsKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tracked_accounts")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateTrackedAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: TrackedAccountInsert) => {
      const { data, error } = await supabase
        .from("tracked_accounts")
        .insert(input)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: trackedAccountsKey }),
  });
}

export function useUpdateTrackedAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: TrackedAccountUpdate }) => {
      const { data, error } = await supabase
        .from("tracked_accounts")
        .update(patch)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: trackedAccountsKey }),
  });
}

export function useDeleteTrackedAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("tracked_accounts").delete().eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: trackedAccountsKey }),
  });
}

// ---------- Watchlists ----------
export type Watchlist = Tables<"watchlists">;

export function useWatchlists() {
  return useQuery({
    queryKey: ["watchlists"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("watchlists")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useSetWatchlistAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      accountId,
      watchlistId,
    }: {
      accountId: string;
      watchlistId: string | null;
    }) => {
      // Replace: remove existing links for the account, then add the new one.
      const { error: delErr } = await supabase
        .from("watchlist_accounts")
        .delete()
        .eq("account_id", accountId);
      if (delErr) throw delErr;
      if (watchlistId) {
        const { error } = await supabase
          .from("watchlist_accounts")
          .insert({ account_id: accountId, watchlist_id: watchlistId });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["watchlist_accounts"] });
      qc.invalidateQueries({ queryKey: trackedAccountsKey });
    },
  });
}

export function useWatchlistAssignments() {
  return useQuery({
    queryKey: ["watchlist_accounts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("watchlist_accounts")
        .select("account_id, watchlist_id");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useAccountAssetCounts() {
  return useQuery({
    queryKey: ["account_asset_counts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("assets")
        .select("account_id");
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const row of data ?? []) {
        const key = (row as { account_id: string }).account_id;
        counts[key] = (counts[key] ?? 0) + 1;
      }
      return counts;
    },
  });
}


// ---------- Assets ----------
export type AssetRow = Tables<"assets">;

export function useAssets(limit = 100) {
  return useQuery({
    queryKey: ["assets", limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("assets")
        .select("*, tracked_accounts(username,display_name,avatar_url), asset_status(state)")
        .order("detected_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data ?? [];
    },
  });
}

// ---------- Scanner runs ----------
export function useScannerRuns(limit = 20) {
  return useQuery({
    queryKey: ["scanner_runs", limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scanner_runs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data ?? [];
    },
  });
}

// ---------- Activity log ----------
export function useActivityLog(limit = 50) {
  return useQuery({
    queryKey: ["activity_log", limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activity_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data ?? [];
    },
  });
}
