import { useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ActivityEventType =
  | "login"
  | "logout"
  | "account_added"
  | "account_edited"
  | "account_removed"
  | "location_added"
  | "location_edited"
  | "location_removed"
  | "scan_started"
  | "scan_completed"
  | "scan_failed"
  | "scan_retry_scheduled"
  | "asset_detected"
  | "asset_downloaded"
  | "asset_kept"
  | "asset_dismissed"
  | "asset_archived"
  | "asset_prioritized"
  | "asset_undo"
  | "publishing_paused"
  | "publishing_resumed"
  | "error";

export type ActivityRow = {
  id: string;
  event_type: string;
  description: string;
  metadata: Record<string, unknown> | null;
  actor_id: string | null;
  created_at: string;
};

const CATEGORY_ORDER: ActivityEventType[] = [
  "login",
  "logout",
  "account_added",
  "account_edited",
  "account_removed",
  "scan_started",
  "scan_completed",
  "scan_failed",
  "scan_retry_scheduled",
  "asset_detected",
  "asset_downloaded",
  "asset_kept",
  "asset_dismissed",
  "asset_archived",
  "asset_prioritized",
  "asset_undo",
  "error",
];

export const ACTIVITY_TYPES: readonly ActivityEventType[] = CATEGORY_ORDER;

// ---- Fire-and-forget writer ----

let lastActorId: string | null = null;
async function currentActorId(): Promise<string | null> {
  if (lastActorId) return lastActorId;
  const { data } = await supabase.auth.getUser();
  lastActorId = data.user?.id ?? null;
  return lastActorId;
}
supabase.auth.onAuthStateChange((_e, session) => {
  lastActorId = session?.user?.id ?? null;
});

export async function logActivity(
  event_type: ActivityEventType,
  description: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    const actor_id = await currentActorId();
    if (!actor_id) return; // insert policy requires operator role
    const { error } = await supabase.from("activity_log").insert({
      event_type,
      description,
      metadata: (metadata ?? null) as never,
      actor_id,
    });
    if (error) console.warn("[activity] insert failed", error);
  } catch (err) {
    console.warn("[activity] insert threw", err);
  }
}

// ---- Live store ----

type State = { rows: ActivityRow[]; loaded: boolean };
let state: State = { rows: [], loaded: false };
let channel: ReturnType<typeof supabase.channel> | null = null;
const listeners = new Set<() => void>();

function emit() {
  state = { ...state, rows: [...state.rows] };
  listeners.forEach((l) => l());
}

async function loadAll() {
  const { data, error } = await supabase
    .from("activity_log")
    .select("id,event_type,description,metadata,actor_id,created_at")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) {
    console.error("[activity] load failed", error);
    return;
  }
  state = { rows: (data ?? []) as unknown as ActivityRow[], loaded: true };
  emit();
}

function ensureChannel() {
  if (channel) return;
  channel = supabase
    .channel("activity-log")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "activity_log" },
      (payload) => {
        const row = payload.new as unknown as ActivityRow;
        if (!row?.id) return;
        // dedupe
        if (state.rows.some((r) => r.id === row.id)) return;
        state = {
          rows: [row, ...state.rows].slice(0, 1000),
          loaded: state.loaded,
        };
        emit();
      },
    )
    .subscribe();
}

function subscribe(l: () => void) {
  listeners.add(l);
  if (!state.loaded) {
    void loadAll();
    ensureChannel();
  }
  return () => {
    listeners.delete(l);
  };
}

function getSnapshot() {
  return state;
}

export function useActivityFeed() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function refreshActivity() {
  return loadAll();
}

// ---- Global error hook ----

let errorHooksInstalled = false;
export function installGlobalErrorLogging() {
  if (errorHooksInstalled || typeof window === "undefined") return;
  errorHooksInstalled = true;
  window.addEventListener("error", (ev) => {
    const msg = ev.message ?? String(ev.error ?? "unknown error");
    void logActivity("error", msg.slice(0, 240), {
      source: ev.filename ?? undefined,
      line: ev.lineno ?? undefined,
    });
  });
  window.addEventListener("unhandledrejection", (ev) => {
    const reason =
      ev.reason instanceof Error
        ? ev.reason.message
        : typeof ev.reason === "string"
          ? ev.reason
          : "unhandled rejection";
    void logActivity("error", reason.slice(0, 240), { kind: "rejection" });
  });
}

// ---- Auth transitions ----

let authHooksInstalled = false;
export function installAuthActivityLogging() {
  if (authHooksInstalled) return;
  authHooksInstalled = true;
  let prev: string | null = null;
  supabase.auth.getUser().then(({ data }) => {
    prev = data.user?.id ?? null;
  });
  supabase.auth.onAuthStateChange((event, session) => {
    const nextId = session?.user?.id ?? null;
    if (event === "SIGNED_IN" && nextId && nextId !== prev) {
      void logActivity("login", `Operator signed in`, {
        email: session?.user?.email,
      });
      prev = nextId;
    } else if (event === "SIGNED_OUT" && prev) {
      // Insert while still authenticated is impossible after sign-out;
      // best-effort — the previous user_id may already be gone. Still fires
      // when tokens refresh into logout.
      void logActivity("logout", "Operator signed out");
      prev = null;
    }
  });
}
