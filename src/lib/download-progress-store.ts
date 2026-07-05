import { useSyncExternalStore } from "react";
import type { DownloadTarget } from "./downloads-store";

export type DownloadPhase =
  | "queued"
  | "fetching"
  | "writing"
  | "success"
  | "error";

export type DownloadProgressItem = {
  id: string; // asset id (also the store key)
  target: DownloadTarget;
  phase: DownloadPhase;
  received: number; // bytes
  total: number; // bytes (0 if unknown)
  filename: string | null;
  error: string | null;
  startedAt: number;
  endedAt: number | null;
  // Batch grouping (optional)
  batchId?: string | null;
};

export type BatchState = {
  id: string;
  total: number;
  done: number;
  failed: number;
  startedAt: number;
  endedAt: number | null;
};

type State = {
  items: Map<string, DownloadProgressItem>;
  order: string[]; // insertion order (newest last)
  batches: Map<string, BatchState>;
  panelOpen: boolean;
};

let state: State = {
  items: new Map(),
  order: [],
  batches: new Map(),
  panelOpen: false,
};
const listeners = new Set<() => void>();

function emit() {
  state = {
    items: new Map(state.items),
    order: [...state.order],
    batches: new Map(state.batches),
    panelOpen: state.panelOpen,
  };
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function getSnapshot() {
  return state;
}

export function useDownloadProgress() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ---- mutations ----

export function startProgress(
  target: DownloadTarget,
  batchId: string | null = null,
) {
  const existing = state.items.get(target.id);
  const now = Date.now();
  const item: DownloadProgressItem = {
    id: target.id,
    target,
    phase: "fetching",
    received: 0,
    total: 0,
    filename: existing?.filename ?? null,
    error: null,
    startedAt: now,
    endedAt: null,
    batchId,
  };
  state.items.set(target.id, item);
  if (!state.order.includes(target.id)) state.order.push(target.id);
  state.panelOpen = true;
  emit();
}

export function updateProgress(
  id: string,
  patch: Partial<DownloadProgressItem>,
) {
  const cur = state.items.get(id);
  if (!cur) return;
  state.items.set(id, { ...cur, ...patch });
  emit();
}

export function completeProgress(
  id: string,
  ok: boolean,
  filename: string | null,
  error: string | null,
) {
  const cur = state.items.get(id);
  if (!cur) return;
  state.items.set(id, {
    ...cur,
    phase: ok ? "success" : "error",
    filename: filename ?? cur.filename,
    error: ok ? null : error ?? "Download failed",
    endedAt: Date.now(),
  });
  if (cur.batchId) {
    const b = state.batches.get(cur.batchId);
    if (b) {
      const next: BatchState = {
        ...b,
        done: b.done + (ok ? 1 : 0),
        failed: b.failed + (ok ? 0 : 1),
      };
      if (next.done + next.failed >= next.total) next.endedAt = Date.now();
      state.batches.set(cur.batchId, next);
    }
  }
  emit();
}

export function startBatch(total: number): string {
  const id = `b_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  state.batches.set(id, {
    id,
    total,
    done: 0,
    failed: 0,
    startedAt: Date.now(),
    endedAt: null,
  });
  state.panelOpen = true;
  emit();
  return id;
}

export function dismissItem(id: string) {
  state.items.delete(id);
  state.order = state.order.filter((x) => x !== id);
  emit();
}

export function clearFinished() {
  const remaining: string[] = [];
  for (const id of state.order) {
    const it = state.items.get(id);
    if (!it) continue;
    if (it.phase === "success" || it.phase === "error") {
      state.items.delete(id);
    } else {
      remaining.push(id);
    }
  }
  state.order = remaining;
  // Clear finished batches too
  for (const [bid, b] of state.batches) {
    if (b.endedAt != null) state.batches.delete(bid);
  }
  if (state.items.size === 0) state.panelOpen = false;
  emit();
}

export function setPanelOpen(open: boolean) {
  state.panelOpen = open;
  emit();
}
