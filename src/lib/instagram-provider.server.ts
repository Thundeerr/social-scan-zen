/**
 * InstagramProvider — server-only.
 *
 * Fetches recent media for a public Instagram account via RapidAPI. The
 * exact endpoint shape varies by RapidAPI host, so the mapper accepts
 * several common response shapes and normalises them to a stable
 * ProviderResponse.
 */

export type ProviderPost = {
  external_id: string;
  media_type: "image" | "video";
  caption: string;
  thumbnail_url: string | null;
  media_url: string | null;
  source_url: string | null;
  likes: number;
  comments: number;
  posted_at: string | null;
};

export type ProviderResponse = {
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  posts: ProviderPost[];
};

const DEFAULT_PATH = "/user-medias";

function pick<T = unknown>(obj: Record<string, unknown> | null | undefined, keys: string[]): T | null {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null) return v as T;
  }
  return null;
}

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v) || 0;
  return 0;
}

function toIso(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === "number") {
    // Instagram often returns unix seconds
    const ms = v > 1e12 ? v : v * 1000;
    return new Date(ms).toISOString();
  }
  if (typeof v === "string") {
    const n = Number(v);
    if (!Number.isNaN(n) && v.length <= 13) return toIso(n);
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

function normalisePost(raw: Record<string, unknown>): ProviderPost | null {
  const external_id =
    (pick<string>(raw, ["id", "pk", "code", "shortcode", "media_id"]) ?? "").toString();
  if (!external_id) return null;

  const shortcode = pick<string>(raw, ["shortcode", "code"]);
  const caption_raw = pick<unknown>(raw, ["caption", "edge_media_to_caption", "text"]);
  let caption = "";
  if (typeof caption_raw === "string") caption = caption_raw;
  else if (caption_raw && typeof caption_raw === "object") {
    const c = caption_raw as Record<string, unknown>;
    caption = (c.text as string) ?? "";
    if (!caption && Array.isArray((c as { edges?: unknown }).edges)) {
      const edges = c.edges as Array<{ node?: { text?: string } }>;
      caption = edges[0]?.node?.text ?? "";
    }
  }

  const is_video = Boolean(pick(raw, ["is_video", "video_url"])) ||
    pick<string>(raw, ["media_type", "type"]) === "video" ||
    pick<number>(raw, ["media_type"]) === 2;

  const thumbnail_url =
    pick<string>(raw, ["thumbnail_url", "thumbnail_src", "display_url", "image_url"]);
  const video_url = pick<string>(raw, ["video_url", "video_versions", "video"]);
  let media_url: string | null = null;
  if (is_video && video_url) {
    if (typeof video_url === "string") media_url = video_url;
    else if (Array.isArray(video_url)) {
      const first = (video_url as Array<{ url?: string }>)[0];
      media_url = first?.url ?? null;
    }
  } else {
    media_url = thumbnail_url ?? null;
  }

  const likes = toNumber(pick(raw, ["like_count", "likes", "edge_liked_by"]));
  const comments = toNumber(pick(raw, ["comment_count", "comments", "edge_media_to_comment"]));
  const posted_at = toIso(pick(raw, ["taken_at", "taken_at_timestamp", "posted_at", "date"]));
  const source_url = shortcode
    ? `https://instagram.com/p/${shortcode}/`
    : pick<string>(raw, ["permalink", "link"]);

  return {
    external_id,
    media_type: is_video ? "video" : "image",
    caption,
    thumbnail_url: thumbnail_url ?? null,
    media_url,
    source_url: source_url ?? null,
    likes,
    comments,
    posted_at,
  };
}

function normaliseResponse(username: string, payload: unknown): ProviderResponse {
  const root = (payload ?? {}) as Record<string, unknown>;
  const user = (pick<Record<string, unknown>>(root, ["user", "owner", "author"]) ?? {}) as Record<string, unknown>;

  const display_name =
    pick<string>(user, ["full_name", "name", "display_name"]) ??
    pick<string>(root, ["full_name"]) ?? null;
  const avatar_url =
    pick<string>(user, ["profile_pic_url", "avatar_url", "profile_pic_url_hd"]) ??
    pick<string>(root, ["profile_pic_url"]) ?? null;

  let items: unknown =
    pick(root, ["items", "posts", "medias", "data", "edges", "results"]) ??
    pick(pick<Record<string, unknown>>(root, ["data"]) ?? {}, ["items", "medias", "posts"]);
  if (!Array.isArray(items)) items = [];

  const posts = (items as unknown[])
    .map((it) => {
      const rec = (it && typeof it === "object" && "node" in it
        ? (it as { node: Record<string, unknown> }).node
        : (it as Record<string, unknown>)) ?? {};
      return normalisePost(rec);
    })
    .filter((p): p is ProviderPost => Boolean(p));

  return { username, display_name, avatar_url, posts };
}

export type InstagramProviderConfig = {
  apiKey: string;
  host: string;
  path?: string;
  usernameParam?: string;
};

export function createInstagramProvider(cfg: InstagramProviderConfig) {
  const path = cfg.path ?? DEFAULT_PATH;
  const usernameParam = cfg.usernameParam ?? "username";

  async function fetchAccount(username: string): Promise<ProviderResponse> {
    const url = new URL(`https://${cfg.host}${path}`);
    url.searchParams.set(usernameParam, username);
    const res = await fetch(url.toString(), {
      headers: {
        "X-RapidAPI-Key": cfg.apiKey,
        "X-RapidAPI-Host": cfg.host,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Instagram provider ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as unknown;
    return normaliseResponse(username, json);
  }

  return { fetchAccount };
}

export function getInstagramProviderFromEnv() {
  const apiKey = process.env.RAPIDAPI_KEY;
  const host = process.env.RAPIDAPI_HOST;
  if (!apiKey || !host) {
    throw new Error("Instagram provider not configured (missing RAPIDAPI_KEY/RAPIDAPI_HOST)");
  }
  return createInstagramProvider({
    apiKey,
    host,
    path: process.env.RAPIDAPI_PATH,
    usernameParam: process.env.RAPIDAPI_USERNAME_PARAM,
  });
}
