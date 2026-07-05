import type { ProviderPost } from "./instagram-provider.server";

type AssetForDownload = {
  id: string;
  external_id: string | null;
  media_type: string;
  media_url: string | null;
  thumbnail_url: string | null;
  source_url: string | null;
  tracked_accounts:
    | { username: string | null }
    | { username: string | null }[]
    | null;
};

export type PreparedAssetDownload = {
  signedUrl: string;
  storagePath: string;
  filename: string;
  contentType: string;
  fileSize: number;
  sourceUrl: string;
};

function firstAccount(asset: AssetForDownload) {
  return Array.isArray(asset.tracked_accounts)
    ? asset.tracked_accounts[0]
    : asset.tracked_accounts;
}

function sanitizeFilenamePart(value: string) {
  return value
    .replace(/^@/, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "asset";
}

function shortcodeFromUrl(url: string | null) {
  if (!url) return null;
  const match = url.match(/instagram\.com\/(?:p|reel|tv)\/([^/?#]+)/i);
  return match?.[1] ?? null;
}

function extFromContentType(contentType: string, fallback: string) {
  const clean = contentType.split(";")[0]?.trim().toLowerCase();
  if (clean === "image/jpeg") return "jpg";
  if (clean === "image/png") return "png";
  if (clean === "image/webp") return "webp";
  if (clean === "image/gif") return "gif";
  if (clean === "video/mp4") return "mp4";
  if (clean === "video/quicktime") return "mov";
  if (clean?.startsWith("image/")) return clean.slice("image/".length) || fallback;
  if (clean?.startsWith("video/")) return clean.slice("video/".length) || fallback;
  return fallback;
}

function isVideoType(mediaType: string) {
  return ["video", "reel", "story"].includes(mediaType);
}

function postMatchesAsset(post: ProviderPost, asset: AssetForDownload) {
  if (asset.external_id && post.external_id === asset.external_id) return true;
  if (asset.source_url && post.source_url === asset.source_url) return true;
  const assetShortcode = shortcodeFromUrl(asset.source_url);
  const postShortcode = shortcodeFromUrl(post.source_url);
  return Boolean(assetShortcode && postShortcode && assetShortcode === postShortcode);
}

async function resolveFreshMediaUrl(asset: AssetForDownload, username: string) {
  try {
    const { getInstagramProviderFromEnv } = await import("./instagram-provider.server");
    const provider = getInstagramProviderFromEnv();
    const latest = await provider.fetchAccount(username);
    const fresh = latest.posts.find((post) => postMatchesAsset(post, asset));
    if (fresh) return fresh.media_url ?? fresh.thumbnail_url ?? null;
  } catch (error) {
    console.warn(
      "[download-media] fresh provider lookup failed; falling back to stored media URL",
      error instanceof Error ? error.message : error,
    );
  }
  return asset.media_url ?? asset.thumbnail_url ?? null;
}

async function fetchMediaBytes(asset: AssetForDownload, mediaUrl: string) {
  const res = await fetch(mediaUrl, {
    headers: {
      Accept: isVideoType(asset.media_type) ? "video/*,*/*" : "image/*,*/*",
      Referer: "https://www.instagram.com/",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Media fetch failed ${res.status}${body ? `: ${body.slice(0, 120)}` : ""}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  if (bytes.byteLength === 0) throw new Error("Media fetch returned an empty file");

  return {
    arrayBuffer,
    bytes,
    contentType: res.headers.get("content-type"),
  };
}

export async function prepareAssetDownload(input: {
  asset: AssetForDownload;
  userId: string;
}): Promise<PreparedAssetDownload> {
  const { asset, userId } = input;
  const username = firstAccount(asset)?.username ?? "unknown";
  let mediaUrl = asset.media_url ?? asset.thumbnail_url ?? null;
  let fetched:
    | { arrayBuffer: ArrayBuffer; bytes: Uint8Array; contentType: string | null }
    | null = null;

  if (mediaUrl) {
    try {
      fetched = await fetchMediaBytes(asset, mediaUrl);
    } catch (error) {
      console.warn(
        "[download-media] stored media URL failed; resolving a fresh provider URL",
        error instanceof Error ? error.message : error,
      );
    }
  }

  if (!fetched) {
    const freshUrl = await resolveFreshMediaUrl(asset, username);
    if (!freshUrl) throw new Error("No media URL available for this asset");
    mediaUrl = freshUrl;
    fetched = await fetchMediaBytes(asset, freshUrl);
  }

  const fallbackContentType = isVideoType(asset.media_type) ? "video/mp4" : "image/jpeg";
  const contentType = fetched.contentType ?? fallbackContentType;

  const fallbackExt = isVideoType(asset.media_type) ? "mp4" : "jpg";
  const ext = extFromContentType(contentType, fallbackExt);
  const safeHandle = sanitizeFilenamePart(username);
  const filename = `${safeHandle}-${asset.id}.${ext}`;
  const storagePath = `${userId}/downloads/${asset.id}-${Date.now()}.${ext}`;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const bucket = supabaseAdmin.storage.from("ig-publish");
  const { error: uploadError } = await bucket.upload(storagePath, arrayBuffer, {
    contentType,
    cacheControl: "31536000",
    upsert: true,
  });
  if (uploadError) throw new Error(uploadError.message);

  const { data, error: signedError } = await bucket.createSignedUrl(storagePath, 60 * 10, {
    download: filename,
  });
  if (signedError || !data?.signedUrl) {
    throw new Error(signedError?.message ?? "Could not create download URL");
  }

  return {
    signedUrl: data.signedUrl,
    storagePath,
    filename,
    contentType,
    fileSize: fetched.bytes.byteLength,
    sourceUrl: mediaUrl,
  };
}