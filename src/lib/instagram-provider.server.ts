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

export type LocationProviderResponse = {
  location_id: string;
  name: string | null;
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

/**
 * Walk an object graph and collect anything that looks like a post record.
 * Used as a fallback when the top-level structure doesn't match any of the
 * documented shapes (e.g. Instagram's `sections[].layout_content.medias[].media`
 * nesting used by location-feed endpoints).
 */
function collectPostLike(payload: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const seen = new WeakSet<object>();
  const stack: unknown[] = [payload];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (seen.has(node as object)) continue;
    seen.add(node as object);
    if (Array.isArray(node)) {
      for (const v of node) stack.push(v);
      continue;
    }
    const rec = node as Record<string, unknown>;
    // Instagram's location-feed nesting: unwrap `{ media: {...} }` and
    // `{ layout_content: { medias: [{ media: {...} }] } }`.
    if (rec.media && typeof rec.media === "object" && !Array.isArray(rec.media)) {
      stack.push(rec.media);
    }
    const hasId = typeof rec.id === "string" || typeof rec.pk === "string" ||
      typeof rec.pk === "number" || typeof rec.code === "string" ||
      typeof rec.shortcode === "string";
    const looksLikePost = hasId && (
      "media_type" in rec || "image_versions2" in rec || "caption" in rec ||
      "taken_at" in rec || "taken_at_timestamp" in rec || "video_versions" in rec ||
      "display_url" in rec || "thumbnail_url" in rec
    );
    if (looksLikePost) {
      out.push(rec);
      // don't descend further into a matched post
      continue;
    }
    for (const v of Object.values(rec)) stack.push(v);
  }
  return out;
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

  let posts = (items as unknown[])
    .map((it) => {
      const rec = (it && typeof it === "object" && "node" in it
        ? (it as { node: Record<string, unknown> }).node
        : (it as Record<string, unknown>)) ?? {};
      return normalisePost(rec);
    })
    .filter((p): p is ProviderPost => Boolean(p));

  // Fallback: the response uses a nested shape (Instagram location-feed style,
  // `sections[].layout_content.medias[].media`). Walk the graph.
  if (posts.length === 0) {
    const candidates = collectPostLike(root);
    posts = candidates
      .map((rec) => normalisePost(rec))
      .filter((p): p is ProviderPost => Boolean(p));
  }

  return { username, display_name, avatar_url, posts };
}


export type InstagramProviderConfig = {
  apiKey: string;
  host: string;
  path?: string;
  usernameParam?: string;
  /**
   * When set (e.g. `/profile` for instagram-looter2), the provider first
   * resolves username → numeric IG user id via this endpoint, then calls the
   * main media endpoint with `usernameParam` = that id. Required by hosts
   * whose media endpoint accepts only numeric ids (`/user-feeds?id=…`).
   */
  profilePath?: string;
  /** Extra query params appended to the media request (e.g. `count=30`). */
  extraParams?: Record<string, string>;
  /** Endpoint returning recent media for a given Instagram location id. */
  locationPath?: string;
  /** Query param name expected by the location endpoint (e.g. `id`, `location_id`). */
  locationIdParam?: string;
  /** Extra query params appended to the location request. */
  locationExtraParams?: Record<string, string>;
};

/** Walk a nested object and return the first non-empty numeric IG id found. */
function extractUserId(payload: unknown): string | null {
  const seen = new Set<unknown>();
  const stack: unknown[] = [payload];
  const idKeys = new Set(["id", "pk", "user_id", "fbid_v2"]);
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    const rec = node as Record<string, unknown>;
    for (const key of idKeys) {
      const raw = rec[key];
      if (typeof raw === "string" && /^\d+$/.test(raw)) return raw;
      if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
    }
    for (const value of Object.values(rec)) {
      if (value && typeof value === "object") stack.push(value);
    }
  }
  return null;
}

/** Extract avatar url + display name from a profile-endpoint response. */
function extractProfileMeta(payload: unknown): { avatar_url: string | null; display_name: string | null } {
  const seen = new Set<unknown>();
  const stack: unknown[] = [payload];
  let avatar_url: string | null = null;
  let display_name: string | null = null;
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    const rec = node as Record<string, unknown>;
    if (!avatar_url) {
      const a =
        (rec.profile_pic_url_hd as string | undefined) ??
        (rec.profile_pic_url as string | undefined) ??
        (rec.avatar_url as string | undefined);
      if (typeof a === "string" && a.startsWith("http")) avatar_url = a;
    }
    if (!display_name) {
      const n = (rec.full_name as string | undefined) ?? (rec.display_name as string | undefined);
      if (typeof n === "string" && n) display_name = n;
    }
    if (avatar_url && display_name) break;
    for (const value of Object.values(rec)) {
      if (value && typeof value === "object") stack.push(value);
    }
  }
  return { avatar_url, display_name };
}

export function createInstagramProvider(cfg: InstagramProviderConfig) {
  const path = cfg.path ?? DEFAULT_PATH;
  const usernameParam = cfg.usernameParam ?? "username";
  const headers = {
    "X-RapidAPI-Key": cfg.apiKey,
    "X-RapidAPI-Host": cfg.host,
  };

  async function resolveProfile(
    username: string,
  ): Promise<{ lookupValue: string; avatar_url: string | null; display_name: string | null }> {
    if (!cfg.profilePath) {
      return { lookupValue: username, avatar_url: null, display_name: null };
    }
    const url = new URL(`https://${cfg.host}${cfg.profilePath}`);
    url.searchParams.set("username", username);
    const res = await fetch(url.toString(), { headers });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Instagram profile lookup ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as unknown;
    const id = extractUserId(json);
    if (!id) throw new Error(`Could not resolve user id for @${username}`);
    const meta = extractProfileMeta(json);
    return { lookupValue: id, avatar_url: meta.avatar_url, display_name: meta.display_name };
  }

  async function fetchAccount(username: string): Promise<ProviderResponse> {
    const { lookupValue, avatar_url, display_name } = await resolveProfile(username);
    const url = new URL(`https://${cfg.host}${path}`);
    url.searchParams.set(usernameParam, lookupValue);
    for (const [k, v] of Object.entries(cfg.extraParams ?? {})) {
      url.searchParams.set(k, v);
    }
    const res = await fetch(url.toString(), { headers });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Instagram provider ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as unknown;
    const normalised = normaliseResponse(username, json);
    return {
      ...normalised,
      avatar_url: normalised.avatar_url ?? avatar_url,
      display_name: normalised.display_name ?? display_name,
    };
  }

  async function fetchLocation(locationId: string): Promise<LocationProviderResponse> {
    // Default to the instagram-looter2 convention (same host as accounts):
    //   GET https://<host>/location-feeds?id=<location_id>
    // Override via RAPIDAPI_LOCATION_PATH / RAPIDAPI_LOCATION_ID_PARAM if
    // the connected RapidAPI host uses a different path (e.g. `/v1/location_media`).
    const locationPath = cfg.locationPath ?? "/location-feeds";
    const paramName = cfg.locationIdParam ?? "id";
    const url = new URL(`https://${cfg.host}${locationPath}`);
    url.searchParams.set(paramName, locationId);
    for (const [k, v] of Object.entries(cfg.locationExtraParams ?? {})) {
      url.searchParams.set(k, v);
    }
    const res = await fetch(url.toString(), { headers });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Instagram location provider ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as unknown;
    const normalised = normaliseResponse(locationId, json);
    // Location endpoints often include a `name` or `location.name` field.
    let name: string | null = null;
    if (json && typeof json === "object") {
      const root = json as Record<string, unknown>;
      const loc = (pick<Record<string, unknown>>(root, ["location", "data"]) ?? root) as Record<string, unknown>;
      name = pick<string>(loc, ["name", "title", "short_name"]) ?? null;
    }
    return { location_id: locationId, name, posts: normalised.posts };
  }

  return { fetchAccount, fetchLocation };
}

export function getInstagramProviderFromEnv() {
  const apiKey = process.env.RAPIDAPI_KEY;
  const host = process.env.RAPIDAPI_HOST;
  if (!apiKey || !host) {
    throw new Error("Instagram provider not configured (missing RAPIDAPI_KEY/RAPIDAPI_HOST)");
  }
  // Optional: `RAPIDAPI_EXTRA_PARAMS` is a URL-encoded query string like
  // `count=30&max_id=` — appended verbatim to the media request.
  const extraParams: Record<string, string> = {};
  const raw = process.env.RAPIDAPI_EXTRA_PARAMS;
  if (raw) {
    for (const [k, v] of new URLSearchParams(raw).entries()) extraParams[k] = v;
  }
  const locationExtraParams: Record<string, string> = {};
  const rawLoc = process.env.RAPIDAPI_LOCATION_EXTRA_PARAMS;
  if (rawLoc) {
    for (const [k, v] of new URLSearchParams(rawLoc).entries()) locationExtraParams[k] = v;
  }
  return createInstagramProvider({
    apiKey,
    host,
    path: process.env.RAPIDAPI_PATH,
    usernameParam: process.env.RAPIDAPI_USERNAME_PARAM,
    profilePath: process.env.RAPIDAPI_PROFILE_PATH,
    extraParams,
    locationPath: process.env.RAPIDAPI_LOCATION_PATH,
    locationIdParam: process.env.RAPIDAPI_LOCATION_ID_PARAM,
    locationExtraParams,
  });
}

/** Build the outbound provider URL for display (no secrets). */
export function describeProviderRequest(username: string): string {
  const host = process.env.RAPIDAPI_HOST ?? "provider";
  const path = process.env.RAPIDAPI_PATH ?? DEFAULT_PATH;
  const param = process.env.RAPIDAPI_USERNAME_PARAM ?? "username";
  const profilePath = process.env.RAPIDAPI_PROFILE_PATH;
  if (profilePath) {
    return `GET https://${host}${profilePath}?username=${username} → GET https://${host}${path}?${param}=<id>`;
  }
  return `GET https://${host}${path}?${param}=${username}`;
}

export function describeLocationProviderRequest(locationId: string): string {
  const host = process.env.RAPIDAPI_HOST ?? "provider";
  const path = process.env.RAPIDAPI_LOCATION_PATH ?? "/location-feeds";
  const param = process.env.RAPIDAPI_LOCATION_ID_PARAM ?? "id";
  return `GET https://${host}${path}?${param}=${locationId}`;
}

// ---------------------------------------------------------------------------
// Location search
// ---------------------------------------------------------------------------

export type LocationSearchResult = {
  location_id: string;
  name: string;
  city: string | null;
  country: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  media_count: number | null;
  thumbnail_url: string | null;
};

function collectPlaceLike(payload: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const seen = new WeakSet<object>();
  const stack: unknown[] = [payload];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (seen.has(node as object)) continue;
    seen.add(node as object);
    if (Array.isArray(node)) {
      for (const v of node) stack.push(v);
      continue;
    }
    const rec = node as Record<string, unknown>;
    if (rec.place && typeof rec.place === "object") stack.push(rec.place);
    if (rec.location && typeof rec.location === "object") stack.push(rec.location);
    if (rec.node && typeof rec.node === "object") stack.push(rec.node);

    const idCandidate =
      (rec.pk ?? rec.id ?? rec.external_id ?? rec.facebook_places_id ?? rec.location_id) as unknown;
    const hasId =
      (typeof idCandidate === "string" && /^\d{3,20}$/.test(idCandidate)) ||
      (typeof idCandidate === "number" && Number.isFinite(idCandidate));
    const hasName = typeof rec.name === "string" || typeof rec.title === "string";
    const looksLikePlace = hasId && hasName && !("media_type" in rec) && !("taken_at" in rec);
    if (looksLikePlace) {
      out.push(rec);
      continue;
    }
    for (const v of Object.values(rec)) stack.push(v);
  }
  return out;
}

function normalisePlace(raw: Record<string, unknown>): LocationSearchResult | null {
  const idRaw =
    (raw.pk ?? raw.id ?? raw.external_id ?? raw.facebook_places_id ?? raw.location_id) as unknown;
  const location_id =
    typeof idRaw === "number" ? String(idRaw) : typeof idRaw === "string" ? idRaw : "";
  if (!location_id || !/^\d{3,20}$/.test(location_id)) return null;

  const name = pick<string>(raw, ["name", "title", "short_name"]);
  if (!name) return null;

  const city = pick<string>(raw, ["city", "city_name"]);
  const country = pick<string>(raw, ["country", "country_name", "country_code"]);
  const address = pick<string>(raw, ["address", "street_address", "address_street"]);
  const lat = (raw.lat ?? raw.latitude) as unknown;
  const lng = (raw.lng ?? raw.longitude ?? raw.lon) as unknown;
  const media_count = pick<number | string>(raw, [
    "media_count",
    "post_count",
    "posts_count",
    "count",
  ]);
  const thumbnail_url = pick<string>(raw, [
    "profile_pic_url",
    "thumbnail_url",
    "image_url",
    "cover_photo_url",
  ]);

  return {
    location_id,
    name,
    city: city ?? null,
    country: country ?? null,
    address: address ?? null,
    lat: typeof lat === "number" ? lat : typeof lat === "string" ? Number(lat) || null : null,
    lng: typeof lng === "number" ? lng : typeof lng === "string" ? Number(lng) || null : null,
    media_count:
      typeof media_count === "number"
        ? media_count
        : typeof media_count === "string"
          ? Number(media_count) || null
          : null,
    thumbnail_url: thumbnail_url ?? null,
  };
}

/** Public Instagram topsearch fallback — no API key, best-effort. */
async function fallbackTopsearch(query: string): Promise<LocationSearchResult[]> {
  try {
    const url = new URL("https://www.instagram.com/web/search/topsearch/");
    url.searchParams.set("context", "place");
    url.searchParams.set("query", query);
    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        Accept: "application/json",
        "X-IG-App-ID": "936619743392459",
      },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as unknown;
    return collectPlaceLike(json)
      .map((p) => normalisePlace(p))
      .filter((p): p is LocationSearchResult => Boolean(p))
      .slice(0, 20);
  } catch {
    return [];
  }
}

// ---- Fuzzy matching helpers -----------------------------------------------

function normaliseText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let curr = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      const next = Math.min(prev[j] + 1, curr + 1, prev[j - 1] + cost);
      prev[j - 1] = curr;
      curr = next;
    }
    prev[b.length] = curr;
  }
  return prev[b.length];
}

/** 0..1 similarity between query and place, using name + city + country. */
function similarity(query: string, place: LocationSearchResult): number {
  const q = normaliseText(query);
  if (!q) return 0;
  const haystack = normaliseText(
    [place.name, place.city, place.country, place.address].filter(Boolean).join(" "),
  );
  if (!haystack) return 0;
  const qTokens = q.split(" ").filter(Boolean);
  const hTokens = new Set(haystack.split(" ").filter(Boolean));

  // Substring bonus
  let score = 0;
  if (haystack.includes(q)) score += 0.5;

  // Token overlap
  let matched = 0;
  for (const qt of qTokens) {
    if (hTokens.has(qt)) matched += 1;
    else {
      // partial token match via edit distance
      for (const ht of hTokens) {
        if (Math.abs(ht.length - qt.length) > 3) continue;
        const d = levenshtein(qt, ht);
        const rel = 1 - d / Math.max(qt.length, ht.length);
        if (rel >= 0.75) {
          matched += rel;
          break;
        }
      }
    }
  }
  score += (matched / qTokens.length) * 0.5;
  return Math.min(1, score);
}

/** Progressively expand the query into shorter variants for fuzzy retrieval. */
function buildQueryVariants(query: string): string[] {
  const norm = normaliseText(query);
  const original = query.trim();
  const variants = new Set<string>();
  if (norm) variants.add(norm);
  const tokens = norm.split(" ").filter(Boolean);
  // Drop trailing tokens one by one: "soneva jani maldives" → "soneva jani" → "soneva"
  for (let i = tokens.length - 1; i > 0; i--) {
    variants.add(tokens.slice(0, i).join(" "));
  }
  // Also try each individual token (helps when only one word is recognisable)
  for (const t of tokens) if (t.length >= 3) variants.add(t);
  variants.delete(original.toLowerCase());
  return [...variants].filter((v) => v.length >= 2).slice(0, 5);
}

// ---- Provider search adapter ----------------------------------------------

async function queryProvider(q: string): Promise<LocationSearchResult[]> {
  const apiKey = process.env.RAPIDAPI_KEY;
  const host = process.env.RAPIDAPI_HOST;
  const searchPath = process.env.RAPIDAPI_LOCATION_SEARCH_PATH;
  const searchParam = process.env.RAPIDAPI_LOCATION_SEARCH_QUERY_PARAM ?? "query";

  if (apiKey && host && searchPath) {
    try {
      const url = new URL(`https://${host}${searchPath}`);
      url.searchParams.set(searchParam, q);
      const extraRaw = process.env.RAPIDAPI_LOCATION_SEARCH_EXTRA_PARAMS;
      if (extraRaw) {
        for (const [k, v] of new URLSearchParams(extraRaw)) url.searchParams.set(k, v);
      }
      const res = await fetch(url.toString(), {
        headers: { "X-RapidAPI-Key": apiKey, "X-RapidAPI-Host": host },
      });
      if (res.ok) {
        const json = (await res.json()) as unknown;
        return collectPlaceLike(json)
          .map((p) => normalisePlace(p))
          .filter((p): p is LocationSearchResult => Boolean(p));
      }
    } catch {
      /* fall through */
    }
  }
  return fallbackTopsearch(q);
}

export async function searchLocations(query: string): Promise<{
  results: LocationSearchResult[];
  source: "provider" | "fallback" | "fuzzy" | "empty";
  fuzzy?: boolean;
}> {
  const q = query.trim();
  if (!q) return { results: [], source: "empty" };

  // 1) Exact query
  const primary = await queryProvider(q);
  const seen = new Set<string>();
  const dedupe = (list: LocationSearchResult[]) => {
    const out: LocationSearchResult[] = [];
    for (const r of list) {
      if (seen.has(r.location_id)) continue;
      seen.add(r.location_id);
      out.push(r);
    }
    return out;
  };

  const primaryDeduped = dedupe(primary);

  // Strong match if any result scores well against the query.
  const withScores = primaryDeduped.map((r) => ({ r, s: similarity(q, r) }));
  const hasStrong = withScores.some((x) => x.s >= 0.6);

  if (hasStrong) {
    withScores.sort((a, b) => b.s - a.s);
    return {
      results: withScores.slice(0, 20).map((x) => x.r),
      source: primary === primaryDeduped ? "provider" : "provider",
    };
  }

  // 2) Fuzzy: expand into variants, collect candidates, rank by similarity.
  const variants = buildQueryVariants(q);
  const pool: LocationSearchResult[] = [...primaryDeduped];
  for (const v of variants) {
    if (pool.length >= 60) break;
    try {
      const more = await queryProvider(v);
      for (const r of more) {
        if (seen.has(r.location_id)) continue;
        seen.add(r.location_id);
        pool.push(r);
        if (pool.length >= 60) break;
      }
    } catch {
      /* keep going */
    }
  }

  if (pool.length === 0) {
    return { results: [], source: "empty" };
  }

  const ranked = pool
    .map((r) => ({ r, s: similarity(q, r) }))
    .filter((x) => x.s >= 0.15)
    .sort((a, b) => b.s - a.s)
    .slice(0, 15)
    .map((x) => x.r);

  if (ranked.length === 0) {
    // Nothing scored — return raw pool as best-effort suggestions
    return { results: pool.slice(0, 10), source: "fuzzy", fuzzy: true };
  }

  // If the primary query itself returned nothing, everything is fuzzy.
  const isFuzzy = primaryDeduped.length === 0 || !hasStrong;
  return {
    results: ranked,
    source: isFuzzy ? "fuzzy" : "provider",
    fuzzy: isFuzzy,
  };
}

