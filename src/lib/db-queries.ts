import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { logActivity } from "./activity-log";

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
    refetchInterval: 30_000,
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
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: trackedAccountsKey });
      void logActivity(
        "account_added",
        `Tracking @${data.username}`,
        { account_id: data.id },
      );
    },
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
      return { data, patch };
    },
    onSuccess: ({ data, patch }) => {
      qc.invalidateQueries({ queryKey: trackedAccountsKey });
      void logActivity(
        "account_edited",
        `Updated @${data.username}`,
        { account_id: data.id, changes: patch as Record<string, unknown> },
      );
    },
  });
}

export function useDeleteTrackedAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data: prev } = await supabase
        .from("tracked_accounts")
        .select("id,username")
        .eq("id", id)
        .maybeSingle();
      const { error } = await supabase.from("tracked_accounts").delete().eq("id", id);
      if (error) throw error;
      return { id, username: prev?.username ?? "account" };
    },
    onSuccess: ({ id, username }) => {
      qc.invalidateQueries({ queryKey: trackedAccountsKey });
      void logActivity(
        "account_removed",
        `Stopped tracking @${username}`,
        { account_id: id },
      );
    },
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


// ---------- Tracked locations ----------
export type TrackedLocation = Tables<"tracked_locations">;
export type TrackedLocationInsert = TablesInsert<"tracked_locations">;
export type TrackedLocationUpdate = TablesUpdate<"tracked_locations">;

export const trackedLocationsKey = ["tracked_locations"] as const;

export function useTrackedLocations() {
  return useQuery({
    queryKey: trackedLocationsKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tracked_locations")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 30_000,
  });
}

export function useCreateTrackedLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: TrackedLocationInsert) => {
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData.user) throw new Error("Not signed in");
      const { data, error } = await supabase
        .from("tracked_locations")
        .insert({ ...input, created_by: userData.user.id })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: trackedLocationsKey });
      void logActivity(
        "location_added",
        `Tracking location "${data.name}"`,
        { location_id: data.id },
      );
    },
  });
}

export function useUpdateTrackedLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: TrackedLocationUpdate }) => {
      const { data, error } = await supabase
        .from("tracked_locations")
        .update(patch)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: trackedLocationsKey });
    },
  });
}

export function useDeleteTrackedLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("tracked_locations").delete().eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: trackedLocationsKey });
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
        .select("*, tracked_accounts(username, display_name, avatar_url)")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 15_000,
  });
}

// Live queue view — queued + running, ordered by scheduled_for.
export function useScannerQueue() {
  return useQuery({
    queryKey: ["scanner_queue"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scanner_runs")
        .select("*, tracked_accounts(username, display_name, avatar_url)")
        .in("status", ["queued", "running"])
        .order("scheduled_for", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 5_000,
  });
}

// Aggregate scheduling stats for the scanner dashboard.
export function useScannerStats() {
  return useQuery({
    queryKey: ["scanner_stats"],
    queryFn: async () => {
      const [{ data: accounts }, { data: lastOk }] = await Promise.all([
        supabase
          .from("tracked_accounts")
          .select("id, username, status, next_scan_at, last_scan_at")
          .eq("status", "active"),
        supabase
          .from("scanner_runs")
          .select("id, completed_at, tracked_accounts(username)")
          .eq("status", "completed")
          .order("completed_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      const nextTs = (accounts ?? [])
        .map((a) => (a.next_scan_at ? new Date(a.next_scan_at).getTime() : Infinity))
        .sort((x, y) => x - y)[0];
      return {
        activeAccounts: accounts?.length ?? 0,
        nextScanAt: Number.isFinite(nextTs) ? new Date(nextTs).toISOString() : null,
        lastSuccessAt: lastOk?.completed_at ?? null,
        lastSuccessAccount:
          (lastOk?.tracked_accounts as { username?: string } | null)?.username ?? null,
      };
    },
    refetchInterval: 15_000,
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
    refetchInterval: 10_000,
  });
}
