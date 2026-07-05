import type { Asset } from "./mock-data";
import { trackedAccounts } from "./mock-data";

// -----------------------------------------------------------------------------
// Watchlist tiers — operator priorities, not folders.
//
// Every tracked source belongs to a priority tier. The Asset Inbox ranks
// assets by an Operator Score derived from tier + content signals + engagement
// so the operator always sees "what deserves attention first".
// -----------------------------------------------------------------------------

export type Tier = "S" | "A" | "B" | "C";

export const TIER_ORDER: Tier[] = ["S", "A", "B", "C"];

export const TIER_META: Record<
  Tier,
  {
    tier: Tier;
    label: string;
    weight: number; // contribution to score, 0–40
    color: string; // token class
    border: string;
    bg: string;
    text: string;
  }
> = {
  S: {
    tier: "S",
    label: "Mission Critical",
    weight: 40,
    color: "text-primary",
    border: "border-primary/50",
    bg: "bg-primary/15",
    text: "text-primary",
  },
  A: {
    tier: "A",
    label: "High Priority",
    weight: 28,
    color: "text-success",
    border: "border-success/50",
    bg: "bg-success/12",
    text: "text-success",
  },
  B: {
    tier: "B",
    label: "Normal",
    weight: 16,
    color: "text-foreground/80",
    border: "border-border",
    bg: "bg-muted/40",
    text: "text-foreground/80",
  },
  C: {
    tier: "C",
    label: "Low Priority",
    weight: 8,
    color: "text-muted-foreground",
    border: "border-border/60",
    bg: "bg-muted/20",
    text: "text-muted-foreground",
  },
};

// Seed tier assignments. Curated to match the watchlist personas so scoring
// feels intentional out of the box.
const USERNAME_TIERS: Record<string, Tier> = {
  // S — mission critical accounts
  nike: "S",
  apple: "S",
  spacex: "S",
  louisvuitton: "S",
  ferrari: "S",
  // A — high priority
  adidas: "A",
  chanelofficial: "A",
  gucci: "A",
  prada: "A",
  porsche: "A",
  bmw: "A",
  patagonia: "A",
  arcteryx: "A",
  off____white: "A",
  // B — normal (default). Everything not listed defaults to B.
  natgeo: "B",
  balenciaga: "B",
  mercedesbenz: "B",
  stussy: "B",
  kithnyc: "B",
  ssense: "B",
  aimeleondore: "B",
  carhartt: "B",
  // C — low priority
  rimac_official: "C",
  needlesofficial: "C",
};

export function tierFor(username: string): Tier {
  return USERNAME_TIERS[username] ?? "B";
}

// -----------------------------------------------------------------------------
// Operator Score
//
// A composite 0–100 confidence score. Higher = deserves attention sooner.
// -----------------------------------------------------------------------------

export type ScoreFactor = {
  key: string;
  label: string;
  value: number; // 0–100 normalized contribution
  weight: number; // out of 100
  note?: string;
};

const ACCOUNTS_BY_USERNAME = new Map(
  trackedAccounts.map((a) => [a.username, a] as const),
);

// Content Type contribution — video assets carry more signal than stills.
function contentTypeScore(asset: Asset): { value: number; note: string } {
  if (asset.video) return { value: 100, note: "Video · high signal" };
  return { value: 55, note: "Image" };
}

// AI Content Quality — reuses the same signal detection as the Intelligence
// panel so the operator sees a coherent story between the score and the
// AI summary.
function aiQualityScore(asset: Asset): { value: number; note: string } {
  const cap = asset.caption.toLowerCase();
  const signals: string[] = [];
  if (/drop|launch|new|collection|available/.test(cap)) signals.push("launch");
  if (/collab|partnership|friends/.test(cap)) signals.push("collab");
  if (/limited|edition|500|worldwide/.test(cap)) signals.push("scarcity");
  if (/behind the scenes|studio|archive/.test(cap)) signals.push("BTS");
  const base = 40 + signals.length * 18;
  return {
    value: Math.min(100, base),
    note: signals.length ? signals.join(" · ") : "Editorial",
  };
}

// Engagement — parse the mock `likes` string ("312K", "1.2M") into a scaled
// 0–100 value.
function parseLikes(likes: string): number {
  const m = likes.match(/^([\d.]+)\s*([KMB])?$/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const mult = m[2]?.toUpperCase() === "M" ? 1_000_000 : m[2]?.toUpperCase() === "B" ? 1_000_000_000 : m[2]?.toUpperCase() === "K" ? 1_000 : 1;
  return n * mult;
}
function engagementScore(asset: Asset): { value: number; note: string } {
  const n = parseLikes(asset.likes);
  // 500K → ~100, 100K → ~62, 20K → ~28
  const value = Math.min(100, Math.round((Math.log10(Math.max(1, n)) - 3) * 33));
  return { value: Math.max(5, value), note: `${asset.likes} likes` };
}

// Posting Frequency — normalized against the account's assetsToday.
// Sparse posters (0–1/day) score higher: their asset is rarer, so it's more
// worth attention. Prolific posters (3+/day) score lower.
function frequencyScore(username: string): { value: number; note: string } {
  const acc = ACCOUNTS_BY_USERNAME.get(username);
  const rate = acc?.assetsToday ?? 1;
  const value = rate === 0 ? 95 : rate === 1 ? 80 : rate === 2 ? 55 : rate === 3 ? 35 : 20;
  return { value, note: `${rate}/day` };
}

export function computeOperatorScore(
  asset: Asset,
  { isFavorite = false }: { isFavorite?: boolean } = {},
): { score: number; tier: Tier; factors: ScoreFactor[] } {
  const tier = tierFor(asset.username);
  const tierMeta = TIER_META[tier];

  const ai = aiQualityScore(asset);
  const eng = engagementScore(asset);
  const freq = frequencyScore(asset.username);
  const type = contentTypeScore(asset);

  const factors: ScoreFactor[] = [
    {
      key: "tier",
      label: "Watchlist Priority",
      value: (tierMeta.weight / 40) * 100,
      weight: 32,
      note: `Tier ${tier} · ${tierMeta.label}`,
    },
    { key: "ai", label: "AI Content Quality", value: ai.value, weight: 20, note: ai.note },
    { key: "eng", label: "Engagement", value: eng.value, weight: 18, note: eng.note },
    { key: "freq", label: "Posting Frequency", value: freq.value, weight: 12, note: freq.note },
    { key: "type", label: "Content Type", value: type.value, weight: 10, note: type.note },
    {
      key: "fav",
      label: "Manual Favorite",
      value: isFavorite ? 100 : 0,
      weight: 8,
      note: isFavorite ? "Pinned by operator" : "—",
    },
  ];

  const total = factors.reduce((sum, f) => sum + (f.value * f.weight) / 100, 0);
  const score = Math.max(0, Math.min(100, Math.round(total)));

  return { score, tier, factors };
}

// Ranking helper — stable sort by score desc, then by original queue order.
export function rankByOperatorScore<T extends Asset>(
  assets: T[],
  favorites: Set<string>,
): T[] {
  const scored = assets.map((a, i) => ({
    a,
    i,
    s: computeOperatorScore(a, { isFavorite: favorites.has(a.id) }).score,
  }));
  scored.sort((x, y) => y.s - x.s || x.i - y.i);
  return scored.map((x) => x.a);
}

export function scoreConfidenceLabel(score: number): string {
  if (score >= 85) return "Very High";
  if (score >= 70) return "High";
  if (score >= 55) return "Moderate";
  if (score >= 40) return "Low";
  return "Marginal";
}

export function scoreToneClasses(score: number): {
  ring: string;
  text: string;
  bg: string;
  border: string;
} {
  if (score >= 85)
    return {
      ring: "stroke-primary",
      text: "text-primary",
      bg: "bg-primary/10",
      border: "border-primary/40",
    };
  if (score >= 70)
    return {
      ring: "stroke-success",
      text: "text-success",
      bg: "bg-success/10",
      border: "border-success/40",
    };
  if (score >= 55)
    return {
      ring: "stroke-warning",
      text: "text-warning",
      bg: "bg-warning/10",
      border: "border-warning/40",
    };
  return {
    ring: "stroke-muted-foreground",
    text: "text-muted-foreground",
    bg: "bg-muted/40",
    border: "border-border",
  };
}
