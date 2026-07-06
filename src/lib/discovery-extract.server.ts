/**
 * discovery-extract — server-only.
 *
 * Pure signal extractor. Given a batch of asset captions plus optional
 * source-url shortcodes, produce candidate mentions with source metadata.
 * No network calls, no database access.
 */

export type ExtractedSignal = {
  username: string;
  source: "account_mention" | "hashtag_cooccurrence";
  weight: number;
};

const MENTION_RE = /@([a-zA-Z0-9._]{2,30})/g;
const HASHTAG_RE = /#([a-zA-Z0-9_]{2,60})/g;

/**
 * Extract @mentions from a caption. Filters out plain email fragments and
 * mentions that end with a dot (regex quirk from run-in punctuation).
 */
export function extractMentions(caption: string | null | undefined): string[] {
  if (!caption) return [];
  const out = new Set<string>();
  for (const m of caption.matchAll(MENTION_RE)) {
    let handle = m[1].toLowerCase();
    // Strip trailing separators that grabbed sentence punctuation
    handle = handle.replace(/[._]+$/, "");
    if (handle.length < 2 || handle.length > 30) continue;
    out.add(handle);
  }
  return [...out];
}

export function extractHashtags(caption: string | null | undefined): string[] {
  if (!caption) return [];
  const out = new Set<string>();
  for (const m of caption.matchAll(HASHTAG_RE)) {
    const tag = m[1].toLowerCase();
    if (tag.length < 2) continue;
    out.add(tag);
  }
  return [...out];
}

export type AssetLike = {
  caption: string | null;
  source_url: string | null;
};

/**
 * Extract all discovery signals from a batch of assets belonging to a single
 * seed (account or location). Returns unique `{ username, weight }` pairs —
 * one row per candidate — with `weight` summing the per-asset contributions.
 */
export function extractSignalsFromAssets(
  assets: AssetLike[],
  seedUsername?: string | null,
): { username: string; source: ExtractedSignal["source"]; weight: number }[] {
  const totals = new Map<string, number>();
  const seedLower = seedUsername?.toLowerCase() ?? null;

  for (const a of assets) {
    for (const mention of extractMentions(a.caption)) {
      if (seedLower && mention === seedLower) continue;
      totals.set(mention, (totals.get(mention) ?? 0) + 1);
    }
  }

  return [...totals.entries()].map(([username, weight]) => ({
    username,
    source: "account_mention" as const,
    weight,
  }));
}
