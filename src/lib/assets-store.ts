import { useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Asset } from "./mock-data";
import type { Database } from "@/integrations/supabase/types";
import { logActivity } from "./activity-log";

type Status = Asset["status"];
type ReviewState = Database["public"]["Enums"]["review_state"];

const AVATAR = (u: string) => `https://i.pravatar.cc/120?u=${u}`;

function formatLikes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - then);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function dayBucket(iso: string): Asset["day"] {
  const d = new Date(iso);
  const now = new Date();
  const isSameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return isSameDay ? "today" : "yesterday";
}

const STATE_TO_STATUS: Record<ReviewState, Status> = {
  priority: "new",
  worth_reviewing: "new",
  later: "new",
  reviewed: "downloaded",
  approved: "approved",
  dismissed: "ignored",
  archived: "ignored",
};

const STATUS_TO_STATE: Record<Status, ReviewState> = {
  new: "worth_reviewing",
  approved: "approved",
  ignored: "dismissed",
  downloaded: "reviewed",
};

type Row = {
  id: string;
  caption: string | null;
  media_type: string;
  thumbnail_url: string | null;
  media_url: string | null;
  source_url: string | null;
  likes: number;
  detected_at: string;
  posted_at: string | null;
  tracked_accounts: { username: string; avatar_url: string | null } | null;
  asset_status: { state: ReviewState } | { state: ReviewState }[] | null;
};

function rowToAsset(r: Row): Asset {
  const username = r.tracked_accounts?.username ?? "unknown";
  const state = Array.isArray(r.asset_status)
    ? r.asset_status[0]?.state
    : r.asset_status?.state;
  const status: Status = state ? STATE_TO_STATUS[state] : "new";
  const isVideo = r.media_type === "video";
  return {
    id: r.id,
    username,
    detectedAt: timeAgo(r.posted_at ?? r.detected_at),
    caption: r.caption ?? "",
    thumbnail: r.thumbnail_url ?? r.media_url ?? `https://picsum.photos/seed/${r.id}/800/800`,
    video: isVideo && r.media_url ? r.media_url : undefined,
    avatar: r.tracked_accounts?.avatar_url ?? AVATAR(username),
    status,
    day: dayBucket(r.posted_at ?? r.detected_at),
    likes: formatLikes(r.likes ?? 0),
  };
}

// ---- Module store ----

let assets: Asset[] = [];
let loaded = false;
let channel: ReturnType<typeof supabase.channel> | null = null;
const listeners = new Set<() => void>();

function emit() {
  assets = [...assets];
  listeners.forEach((l) => l());
}

async function loadAll() {
  const { data, error } = await supabase
    .from("assets")
    .select(
      "id, caption, media_type, thumbnail_url, media_url, source_url, likes, detected_at, posted_at, tracked_accounts(username, avatar_url), asset_status(state)",
    )
    .order("detected_at", { ascending: false })
    .limit(200);
  if (error) {
    console.error("[assets-store] load failed", error);
    return;
  }
  assets = (data as unknown as Row[]).map(rowToAsset);
  emit();
}

async function refreshOne(id: string) {
  const { data, error } = await supabase
    .from("assets")
    .select(
      "id, caption, media_type, thumbnail_url, media_url, source_url, likes, detected_at, posted_at, tracked_accounts(username, avatar_url), asset_status(state)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return;
  const mapped = rowToAsset(data as unknown as Row);
  const idx = assets.findIndex((a) => a.id === id);
  if (idx === -1) assets = [mapped, ...assets];
  else assets[idx] = mapped;
  emit();
}

function ensureChannel() {
  if (channel) return;
  channel = supabase
    .channel("assets-inbox")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "assets" },
      (payload) => {
        const row = (payload.new ?? payload.old) as { id?: string };
        if (payload.eventType === "DELETE" && row?.id) {
          assets = assets.filter((a) => a.id !== row.id);
          emit();
          return;
        }
        if (row?.id) void refreshOne(row.id);
      },
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "asset_status" },
      (payload) => {
        const row = (payload.new ?? payload.old) as { asset_id?: string };
        if (row?.asset_id) void refreshOne(row.asset_id);
      },
    )
    .subscribe();
}

function subscribe(l: () => void) {
  listeners.add(l);
  if (!loaded) {
    loaded = true;
    void loadAll();
    ensureChannel();
  }
  return () => {
    listeners.delete(l);
  };
}

function getSnapshot() {
  return assets;
}

export function useAssets() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function refreshAssets() {
  return loadAll();
}

async function setState(id: string, state: ReviewState) {
  // Optimistic
  const idx = assets.findIndex((a) => a.id === id);
  if (idx !== -1) {
    assets[idx] = { ...assets[idx], status: STATE_TO_STATUS[state] };
    emit();
  }
  const { data: userRes } = await supabase.auth.getUser();
  const reviewer_id = userRes.user?.id ?? null;
  const { error } = await supabase
    .from("asset_status")
    .upsert(
      {
        asset_id: id,
        state,
        reviewer_id,
        reviewed_at: new Date().toISOString(),
      },
      { onConflict: "asset_id" },
    );
  if (error) {
    console.error("[assets-store] setState failed", error);
    void refreshOne(id); // revert
  }
}

export function setAssetStatus(id: string, status: Status) {
  void setState(id, STATUS_TO_STATE[status]);
}

import { downloadAsset as runDownload } from "./downloads-store";

async function triggerDownload(a: Asset) {
  const r = assets.find((x) => x.id === a.id);
  await runDownload({
    id: a.id,
    username: a.username,
    media_url: a.video ?? a.thumbnail ?? null,
    thumbnail_url: a.thumbnail ?? null,
    is_video: !!a.video,
  });
  void r; // reserved for future rowToAsset extension
}

export const assetActions = {
  approve: (id: string) => void setState(id, "approved"),
  ignore: (id: string) => void setState(id, "dismissed"),
  download: (id: string) => {
    const a = assets.find((x) => x.id === id);
    if (a) void triggerDownload(a);
    void setState(id, "reviewed");
  },
  reset: (id: string) => void setState(id, "worth_reviewing"),
};

// Awake auth changes: reload when user signs in/out.
supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
    if (loaded) void loadAll();
  }
});
