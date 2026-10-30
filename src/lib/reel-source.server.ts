import { canonicalReel } from "./reel-inbox";

type Failure = "unavailable" | "interrupted" | "setup" | "unsupported";
type AccessFailure =
  | "subscription_required"
  | "invalid_key"
  | "quota_exceeded"
  | "endpoint_access_denied";
type FailureReason =
  | `provider_http_${number}`
  | `provider_http_${401 | 403}_${AccessFailure}`
  | "provider_timeout"
  | "provider_aborted"
  | "provider_type_error"
  | "provider_network";
export class ReelSourceError extends Error {
  constructor(
    readonly code: Failure,
    readonly reason?: FailureReason,
  ) {
    super(code);
  }
}

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
}

async function accessFailure(response: Response): Promise<AccessFailure | undefined> {
  const reader = response.body?.getReader();
  if (!reader) return;
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 8192) return;
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const text = new TextDecoder().decode(bytes);
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
    const body = record(payload);
    const messages = [
      typeof payload === "string" ? payload : null,
      body?.message,
      body?.error,
      record(body?.error)?.message,
    ];
    for (const value of messages) {
      if (typeof value !== "string") continue;
      const message = value.trim();
      if (/^you are not subscribed to this api(?:[.!]|$)/i.test(message))
        return "subscription_required";
      if (/^(?:invalid|missing) api key(?:[.!]|$)/i.test(message)) return "invalid_key";
      if (
        /^(?:quota exceeded(?:[.!]|$)|you have exceeded (?:the )?(?:(?:daily|monthly|hourly) )?(?:quota|request limit|requests limit)\b)/i.test(
          message,
        )
      )
        return "quota_exceeded";
      if (
        /^(?:endpoint access denied(?:[.!]|$)|access to this endpoint is denied(?:[.!]|$)|you (?:do not|don't) have (?:permission|access) to (?:access |use )?this endpoint\b|this endpoint is not (?:available|included) (?:on|in) your (?:current )?plan\b)/i.test(
          message,
        )
      )
        return "endpoint_access_denied";
    }
  } catch {
    // Unknown, truncated or unreadable bodies retain only the HTTP status.
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export function reelProviderConfigured() {
  return (
    Boolean(process.env.RAPIDAPI_KEY) &&
    process.env.RAPIDAPI_HOST === "instagram-looter2.p.rapidapi.com"
  );
}

function allowedVideoUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 16000) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      ["cdninstagram.com", "fbcdn.net"].some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      )
    );
  } catch {
    return false;
  }
}

// Match the requested Reel, never an adjacent recommendation or carousel child.
export function parseReelSource(payload: unknown, shortcode: string) {
  const stack: unknown[] = [payload];
  let visited = 0;
  while (stack.length && visited++ < 500) {
    const value = stack.pop();
    if (Array.isArray(value)) {
      stack.push(...value.slice(0, 50));
      continue;
    }
    const item = record(value);
    if (!item) continue;
    if (item.shortcode === shortcode || item.code === shortcode) {
      if (
        item.media_type === 8 ||
        item.__typename === "GraphSidecar" ||
        item.carousel_media ||
        item.edge_sidecar_to_children
      ) {
        throw new ReelSourceError("unsupported");
      }
      const owner = record(item.owner) ?? record(item.user);
      if (owner?.is_private === true) throw new ReelSourceError("unavailable");
      if (!(item.is_video === true || item.media_type === 2 || item.__typename === "GraphVideo")) {
        throw new ReelSourceError("unsupported");
      }
      const versions = Array.isArray(item.video_versions) ? item.video_versions : [];
      const candidates = versions.map(record).filter((v): v is RecordValue => Boolean(v));
      if (item.video_url)
        candidates.push({ url: item.video_url, width: item.width, height: item.height });
      const selected = candidates
        .filter((v) => allowedVideoUrl(v.url))
        .sort(
          (a, b) =>
            (Number(b.width) || 0) * (Number(b.height) || 0) -
            (Number(a.width) || 0) * (Number(a.height) || 0),
        )[0];
      if (!selected) throw new ReelSourceError("unavailable");
      const edges = record(item.edge_media_to_caption)?.edges;
      const edgeCaption = Array.isArray(edges) ? record(record(edges[0])?.node)?.text : null;
      const caption = typeof item.caption === "string" ? item.caption : record(item.caption)?.text;
      return {
        url: selected.url as string,
        metadata: {
          title: String(caption || edgeCaption || "Instagram Reel").slice(0, 500),
          creator: String(owner?.username || "").slice(0, 200),
        },
      };
    }
    // Only descend response wrappers, not arbitrary profile feeds or recommendations.
    for (const key of [
      "data",
      "items",
      "media",
      "graphql",
      "shortcode_media",
      "xdt_shortcode_media",
      "node",
    ]) {
      if (item[key]) stack.push(item[key]);
    }
  }
  throw new ReelSourceError("unavailable");
}

export async function resolveReelSource(canonicalUrl: string, shortcode: string) {
  const parsed = canonicalReel(canonicalUrl);
  if (parsed.shortcode !== shortcode) throw new ReelSourceError("unsupported");
  if (!reelProviderConfigured()) throw new ReelSourceError("setup");
  const endpoint = new URL("https://instagram-looter2.p.rapidapi.com/post");
  endpoint.searchParams.set("url", parsed.url);
  try {
    const response = await fetch(endpoint, {
      headers: {
        "x-rapidapi-key": process.env.RAPIDAPI_KEY!,
        "x-rapidapi-host": "instagram-looter2.p.rapidapi.com",
        Accept: "application/json",
      },
      // Cloudflare Workers supports manual redirects, not redirect: "error".
      // Reject the returned 3xx below without forwarding the provider key.
      redirect: "manual",
      signal: AbortSignal.timeout(22000),
    });
    if (!response.ok) {
      let reason: FailureReason = `provider_http_${response.status}`;
      if (response.status === 401 || response.status === 403) {
        const access = await accessFailure(response);
        if (access) reason = `provider_http_${response.status}_${access}`;
      } else {
        // A body cleanup failure must not hide the HTTP status already received.
        await response.body?.cancel().catch(() => undefined);
      }
      throw new ReelSourceError(
        response.status === 429 || response.status >= 500
          ? "interrupted"
          : response.status === 401 || response.status === 403
            ? "setup"
            : "unavailable",
        reason,
      );
    }
    const reader = response.body?.getReader();
    if (!reader) throw new ReelSourceError("unavailable");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 2 * 1024 * 1024) {
        await reader.cancel();
        throw new ReelSourceError("unavailable");
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new ReelSourceError("unavailable");
    }
    return parseReelSource(payload, shortcode);
  } catch (error) {
    // Provider bodies, API keys and signed CDN links must never enter logs/errors.
    if (error instanceof ReelSourceError) throw error;
    const name = error instanceof Error ? error.name : "";
    const reason =
      name === "TimeoutError"
        ? "provider_timeout"
        : name === "AbortError"
          ? "provider_aborted"
          : name === "TypeError"
            ? "provider_type_error"
            : "provider_network";
    throw new ReelSourceError("interrupted", reason);
  }
}
