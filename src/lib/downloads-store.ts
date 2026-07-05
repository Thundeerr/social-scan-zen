import { useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "./activity-log";
import { prepareAssetDownloadFn } from "./downloads.functions";
import {
  startProgress,
  updateProgress,
  completeProgress,
  startBatch,
} from "./download-progress-store";

export type DownloadRow = {
  id: string;
  asset_id: string;
  downloaded_by: string | null;
  downloaded_at: string;
  media_url: string | null;
  media_type: string | null;
  filename: string | null;
  file_size: number | null;
  asset?: {
    id: string;
    caption: string | null;
    media_type: string;
    thumbnail_url: string | null;
    media_url: string | null;
    source_url: string | null;
    tracked_accounts: { username: string; avatar_url: string | null } | null;
  } | null;
  operator?: {
    id: string;
    display_name: string | null;
    email: string | null;
  } | null;
};

type State = {
  rows: DownloadRow[];
  countByAsset: Map<string, number>;
  loaded: boolean;
};

let state: State = { rows: [], countByAsset: new Map(), loaded: false };
let channel: ReturnType<typeof supabase.channel> | null = null;
const listeners = new Set<() => void>();

function emit() {
  state = { ...state, rows: [...state.rows] };
  listeners.forEach((l) => l());
}

function computeCounts(rows: DownloadRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.asset_id, (m.get(r.asset_id) ?? 0) + 1);
  return m;
}

async function loadAll() {
  const { data, error } = await supabase
    .from("asset_downloads")
    .select(
      "id, asset_id, downloaded_by, downloaded_at, media_url, media_type, filename, file_size, asset:assets(id, caption, media_type, thumbnail_url, media_url, source_url, tracked_accounts(username, avatar_url))",
    )
    .order("downloaded_at", { ascending: false })
    .limit(500);
  if (error) {
    console.error("[downloads-store] load failed", error);
    return;
  }
  const rows = (data ?? []) as unknown as DownloadRow[];

  // Enrich with operator profile info in a second query (no FK to profiles).
  const userIds = Array.from(
    new Set(rows.map((r) => r.downloaded_by).filter((v): v is string => !!v)),
  );
  if (userIds.length) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name, email")
      .in("id", userIds);
    const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
    for (const r of rows) {
      r.operator = r.downloaded_by ? byId.get(r.downloaded_by) ?? null : null;
    }
  }

  state = { rows, countByAsset: computeCounts(rows), loaded: true };
  emit();
}

function ensureChannel() {
  if (channel) return;
  channel = supabase
    .channel("asset-downloads")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "asset_downloads" },
      () => {
        void loadAll();
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

export function useDownloads() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function refreshDownloads() {
  return loadAll();
}

// ---- Download execution ----

export type DownloadTarget = {
  id: string; // asset id
  username: string;
  media_url?: string | null;
  thumbnail_url?: string | null;
  is_video?: boolean;
};

function extFromMime(mime: string, fallback: string): string {
  const t = mime.split("/")[1] ?? fallback;
  const clean = t.split(";")[0];
  return clean === "jpeg" ? "jpg" : clean;
}

async function blobFromUrlWithProgress(assetId: string, url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Storage fetch failed ${res.status}`);

  const total = Number(res.headers.get("content-length") ?? 0) || 0;
  updateProgress(assetId, { phase: "fetching", total, received: 0 });

  if (res.body && "getReader" in res.body) {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.length;
        updateProgress(assetId, { received });
      }
    }
    const type = res.headers.get("content-type") ?? "";
    return new Blob(chunks as BlobPart[], type ? { type } : undefined);
  }

  const blob = await res.blob();
  updateProgress(assetId, { received: blob.size, total: blob.size });
  return blob;
}

async function downloadOne(
  target: DownloadTarget,
  batchId: string | null = null,
): Promise<{
  ok: boolean;
  blob?: Blob;
  filename: string;
  url: string | null;
  error?: string;
}> {
  const url = target.media_url ?? target.thumbnail_url ?? null;
  const fallbackExt = target.is_video ? "mp4" : "jpg";
  const filenameBase = `${target.username}-${target.id}`;

  startProgress(target, batchId);
  try {
    const prepared = await prepareAssetDownloadFn({ data: { assetId: target.id } });
    updateProgress(target.id, {
      phase: "fetching",
      total: prepared.fileSize,
      received: 0,
      filename: prepared.filename,
    });
    const blob = await blobFromUrlWithProgress(target.id, prepared.signedUrl);

    updateProgress(target.id, { phase: "writing" });
    const ext = extFromMime(blob.type || prepared.contentType, fallbackExt);
    const filename = prepared.filename || `${filenameBase}.${ext}`;
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Give the browser a tick to hand the download off before revoking.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    completeProgress(target.id, true, filename, null);
    return { ok: true, blob, filename, url: `ig-publish:${prepared.storagePath}` };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Network or CORS error";
    const filename = `${filenameBase}.${fallbackExt}`;
    completeProgress(target.id, false, filename, message);
    return { ok: false, filename, url, error: message };
  }
}

async function recordDownload(
  target: DownloadTarget,
  result: { blob?: Blob; filename: string; url: string | null },
) {
  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes.user?.id;
  if (!userId) return;
  const media_type =
    result.blob?.type ?? (target.is_video ? "video/mp4" : "image/jpeg");
  const { error } = await supabase.from("asset_downloads").insert({
    asset_id: target.id,
    downloaded_by: userId,
    media_url: result.url,
    media_type,
    filename: result.filename,
    file_size: result.blob?.size ?? null,
  });
  if (error) {
    console.error("[downloads-store] record failed", error);
    return;
  }
  void logActivity(
    "asset_downloaded",
    `Downloaded ${result.filename} from @${target.username}`,
    {
      asset_id: target.id,
      filename: result.filename,
      file_size: result.blob?.size ?? null,
    },
  );
}

export async function downloadAsset(target: DownloadTarget): Promise<boolean> {
  const result = await downloadOne(target, null);
  if (result.ok) await recordDownload(target, result);
  return result.ok;
}

/** Retry a single asset. Used by the progress panel. */
export async function retryDownload(target: DownloadTarget): Promise<boolean> {
  return downloadAsset(target);
}

export async function batchDownloadAssets(
  targets: DownloadTarget[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ ok: number; failed: number; batchId: string }> {
  const batchId = startBatch(targets.length);
  let ok = 0;
  let failed = 0;
  for (let i = 0; i < targets.length; i++) {
    const result = await downloadOne(targets[i], batchId);
    if (result.ok) {
      await recordDownload(targets[i], result);
      ok++;
    } else {
      failed++;
    }
    onProgress?.(i + 1, targets.length);
    // Small pause so the browser doesn't drop rapid downloads.
    if (i < targets.length - 1) {
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  return { ok, failed, batchId };
}

supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
    if (state.loaded) void loadAll();
  }
});
