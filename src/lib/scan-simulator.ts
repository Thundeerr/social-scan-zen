/**
 * Real scanner state hook.
 *
 * This module used to run an in-memory simulation with hard-coded brand
 * names ("Checked @louisvuitton…"). It's now a thin adapter over the real
 * `scanner_runs` / `assets` tables so the dashboard, top bar and ambient
 * background all reflect actual monitoring activity.
 *
 * The shape returned by `useScanSim()` is preserved so existing consumers
 * don't need to change. Fields we do not yet track in the database
 * (per-request latency, provider request count, success rate) are exposed
 * as neutral defaults instead of fabricated numbers.
 */

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type SimEvent = {
  id: number | string;
  time: string;
  label: string;
  kind: "info" | "success" | "muted";
};

type State = {
  events: SimEvent[];
  isScanning: boolean;
  newAssetsToday: number;
  queueSize: number;
  requests: number;
  successRate: number;
  avgResponse: number;
  lastScanAt: number | null;
  nowTick: number;
};

function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Live view of real scanner state. Refetches every 10s and re-renders
 *  every 5s so relative-time strings stay fresh. */
export function useScanSim(): State {
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNowTick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  const { data } = useQuery({
    queryKey: ["scanner_realtime_state"],
    queryFn: async () => {
      const todayIso = startOfTodayIso();
      const [{ data: runs }, { count: assetsToday }, { data: lastOk }] = await Promise.all([
        supabase
          .from("scanner_runs")
          .select("id,status")
          .in("status", ["queued", "running"]),
        supabase
          .from("assets")
          .select("id", { count: "exact", head: true })
          .gte("detected_at", todayIso),
        supabase
          .from("scanner_runs")
          .select("completed_at")
          .eq("status", "completed")
          .order("completed_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      const isScanning = (runs ?? []).some((r) => r.status === "running");
      const queueSize = (runs ?? []).length;
      const lastScanAt = lastOk?.completed_at
        ? new Date(lastOk.completed_at as string).getTime()
        : null;

      return {
        isScanning,
        queueSize,
        newAssetsToday: assetsToday ?? 0,
        lastScanAt,
      };
    },
    refetchInterval: 10_000,
  });

  return {
    events: [],
    isScanning: data?.isScanning ?? false,
    newAssetsToday: data?.newAssetsToday ?? 0,
    queueSize: data?.queueSize ?? 0,
    // Not tracked in the DB yet. Neutral defaults beat fabricated numbers.
    requests: 0,
    successRate: 100,
    avgResponse: 0,
    lastScanAt: data?.lastScanAt ?? null,
    nowTick,
  };
}

/** Kept for backwards compatibility. The old simulator started a timer
 *  loop that pushed fake events; there's nothing to start now. */
export function useScanSimulator() {
  /* no-op */
}

export function formatLastScan(state: Pick<State, "lastScanAt">): string {
  if (state.lastScanAt == null) return "monitoring";
  const diff = Math.max(0, Date.now() - state.lastScanAt);
  const s = Math.floor(diff / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return `${h} hr ago`;
}
