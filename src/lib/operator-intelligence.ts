import type { Asset } from "./mock-data";
import { trackedAccounts } from "./mock-data";
import { tierFor, TIER_META, type Tier } from "./priority";

// -----------------------------------------------------------------------------
// Operator Intelligence
//
// A long-term learning system. It observes only the operator's own decisions —
// never global trends, never influencer metrics. Over time it becomes an
// increasingly personal analyst that explains recommendations using the
// operator's own history.
//
// The system gathers. The system thinks. The operator decides.
// AI recommends. Operator Intelligence remembers.
// -----------------------------------------------------------------------------

export type CreatorHistory = {
  username: string;
  approved: number;
  dismissed: number;
  downloaded: number;
  reposted: number;
  // Format bias — how many of each format the operator has approved.
  approvedVideo: number;
  approvedImage: number;
};

// Deterministic pseudo-random so seeded history feels stable across reloads.
function h(str: string): number {
  let x = 2166136261;
  for (let i = 0; i < str.length; i++) x = Math.imul(x ^ str.charCodeAt(i), 16777619);
  return (x >>> 0) / 0xffffffff;
}

// Seed each tracked creator with a long-term decision history. Higher tiers
// tend to have higher approval rates in the seed — the operator has been
// curating this watchlist for a while.
function seedForUsername(username: string): CreatorHistory {
  const tier = tierFor(username);
  const base = tier === "S" ? 220 : tier === "A" ? 140 : tier === "B" ? 80 : 40;
  const rApprove = tier === "S" ? 0.88 : tier === "A" ? 0.72 : tier === "B" ? 0.48 : 0.22;

  const r1 = h(username + "a");
  const r2 = h(username + "b");
  const r3 = h(username + "c");
  const r4 = h(username + "d");
  const r5 = h(username + "e");

  // Volume the operator has seen from this creator over time.
  const total = Math.round(base * (0.7 + r1 * 0.7));
  const approved = Math.round(total * (rApprove + (r2 - 0.5) * 0.15));
  const dismissed = Math.max(0, total - approved);
  const downloaded = Math.round(approved * (0.55 + r3 * 0.35));
  const reposted = Math.round(downloaded * (0.35 + r4 * 0.45));
  const videoShare = 0.35 + r5 * 0.45;
  const approvedVideo = Math.round(approved * videoShare);
  const approvedImage = approved - approvedVideo;

  return {
    username,
    approved,
    dismissed,
    downloaded,
    reposted,
    approvedVideo,
    approvedImage,
  };
}

const SEEDED = new Map<string, CreatorHistory>(
  trackedAccounts.map((a) => [a.username, seedForUsername(a.username)] as const),
);

function emptyHistory(username: string): CreatorHistory {
  return {
    username,
    approved: 0,
    dismissed: 0,
    downloaded: 0,
    reposted: 0,
    approvedVideo: 0,
    approvedImage: 0,
  };
}

// Merge seeded long-term memory with live session decisions from the current
// asset store, so approving assets in the UI shifts the operator's stats in
// real time.
export function creatorHistoryFor(
  username: string,
  liveAssets: Asset[],
): CreatorHistory {
  const seed = SEEDED.get(username) ?? emptyHistory(username);
  const live = liveAssets.filter((a) => a.username === username);
  let approved = seed.approved;
  let dismissed = seed.dismissed;
  let downloaded = seed.downloaded;
  let approvedVideo = seed.approvedVideo;
  let approvedImage = seed.approvedImage;
  for (const a of live) {
    if (a.status === "approved" || a.status === "downloaded") {
      approved += 1;
      if (a.video) approvedVideo += 1;
      else approvedImage += 1;
    }
    if (a.status === "downloaded") downloaded += 1;
    if (a.status === "ignored") dismissed += 1;
  }
  return {
    ...seed,
    approved,
    dismissed,
    downloaded,
    approvedVideo,
    approvedImage,
  };
}

// -----------------------------------------------------------------------------
// Aggregates — used to compare a creator or asset to the operator's baseline.
// -----------------------------------------------------------------------------

export type OperatorBaseline = {
  approvalRate: number; // 0–1
  totalApproved: number;
  totalDismissed: number;
  totalDownloaded: number;
  totalReposted: number;
  videoApprovalShare: number; // 0–1, share of approvals that were video
};

export function operatorBaseline(liveAssets: Asset[]): OperatorBaseline {
  let approved = 0;
  let dismissed = 0;
  let downloaded = 0;
  let reposted = 0;
  let approvedVideo = 0;
  let approvedImage = 0;
  for (const seed of SEEDED.values()) {
    approved += seed.approved;
    dismissed += seed.dismissed;
    downloaded += seed.downloaded;
    reposted += seed.reposted;
    approvedVideo += seed.approvedVideo;
    approvedImage += seed.approvedImage;
  }
  for (const a of liveAssets) {
    if (a.status === "approved" || a.status === "downloaded") {
      approved += 1;
      if (a.video) approvedVideo += 1;
      else approvedImage += 1;
    }
    if (a.status === "downloaded") downloaded += 1;
    if (a.status === "ignored") dismissed += 1;
  }
  const total = approved + dismissed;
  return {
    approvalRate: total ? approved / total : 0,
    totalApproved: approved,
    totalDismissed: dismissed,
    totalDownloaded: downloaded,
    totalReposted: reposted,
    videoApprovalShare: approved ? approvedVideo / (approvedVideo + approvedImage) : 0,
  };
}

// Per-tier / watchlist approval rate, blended over seed + live assets.
export function tierApprovalRate(tier: Tier, liveAssets: Asset[]): {
  rate: number;
  approved: number;
  dismissed: number;
} {
  let approved = 0;
  let dismissed = 0;
  for (const acc of trackedAccounts) {
    if (tierFor(acc.username) !== tier) continue;
    const seed = SEEDED.get(acc.username);
    if (!seed) continue;
    approved += seed.approved;
    dismissed += seed.dismissed;
  }
  for (const a of liveAssets) {
    if (tierFor(a.username) !== tier) continue;
    if (a.status === "approved" || a.status === "downloaded") approved += 1;
    if (a.status === "ignored") dismissed += 1;
  }
  const total = approved + dismissed;
  return { rate: total ? approved / total : 0, approved, dismissed };
}

// -----------------------------------------------------------------------------
// Insights — short, human sentences derived only from the operator's history.
// -----------------------------------------------------------------------------

export type InsightTone = "positive" | "neutral" | "caution";
export type InsightKind =
  | "creator"
  | "watchlist"
  | "repost"
  | "format"
  | "download"
  | "similar";

export type OperatorInsight = {
  kind: InsightKind;
  text: string;
  tone: InsightTone;
};

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function operatorInsightsFor(
  asset: Asset,
  liveAssets: Asset[],
): OperatorInsight[] {
  const history = creatorHistoryFor(asset.username, liveAssets);
  const baseline = operatorBaseline(liveAssets);
  const tier = tierFor(asset.username);
  const tierStats = tierApprovalRate(tier, liveAssets);

  const insights: OperatorInsight[] = [];
  const total = history.approved + history.dismissed;
  const rate = total ? history.approved / total : 0;

  // 1) Creator approval rate — the operator's own history with this account.
  if (total >= 8) {
    if (rate >= 0.75) {
      insights.push({
        kind: "creator",
        text: `You have kept ${pct(rate)} of assets from @${asset.username}.`,
        tone: "positive",
      });
    } else if (rate <= 0.35) {
      insights.push({
        kind: "creator",
        text: `You dismiss ${pct(1 - rate)} of assets from @${asset.username}.`,
        tone: "caution",
      });
    } else {
      insights.push({
        kind: "creator",
        text: `You have kept ${pct(rate)} of assets from @${asset.username}.`,
        tone: "neutral",
      });
    }
  }

  // 2) Watchlist tier vs personal baseline.
  const delta = tierStats.rate - baseline.approvalRate;
  const tierLabel = `Tier ${tier} · ${TIER_META[tier].label}`;
  if (tierStats.approved + tierStats.dismissed >= 20) {
    if (delta >= 0.08) {
      insights.push({
        kind: "watchlist",
        text: `${tierLabel} assets outperform your average by ${pct(delta)}.`,
        tone: "positive",
      });
    } else if (delta <= -0.08) {
      insights.push({
        kind: "watchlist",
        text: `${tierLabel} assets underperform your average by ${pct(-delta)}.`,
        tone: "caution",
      });
    }
  }

  // 3) Repost history — a personal signal, never a global one.
  if (history.reposted >= 3) {
    insights.push({
      kind: "repost",
      text: `You have reposted content from @${asset.username} ${history.reposted} times.`,
      tone: "positive",
    });
  }

  // 4) Format preference vs the operator's own approval mix.
  const isVideo = Boolean(asset.video);
  const videoShare = baseline.videoApprovalShare;
  if (baseline.totalApproved >= 50) {
    if (isVideo && videoShare >= 0.55) {
      insights.push({
        kind: "format",
        text: `You approve video ${pct(videoShare)} of the time — above your average.`,
        tone: "positive",
      });
    } else if (!isVideo && videoShare <= 0.4) {
      insights.push({
        kind: "format",
        text: `You approve stills ${pct(1 - videoShare)} of the time — your preferred format.`,
        tone: "positive",
      });
    } else if (isVideo && videoShare <= 0.35) {
      insights.push({
        kind: "format",
        text: `You keep video assets only ${pct(videoShare)} of the time.`,
        tone: "caution",
      });
    }
  }

  // 5) Download history for this creator.
  if (history.downloaded >= 5) {
    insights.push({
      kind: "download",
      text: `You have downloaded ${history.downloaded} assets from @${asset.username}.`,
      tone: "neutral",
    });
  }

  // 6) Similarity — same tier + same format historical read.
  if (isVideo && baseline.videoApprovalShare >= 0.5) {
    insights.push({
      kind: "similar",
      text: `Similar video assets from Tier ${tier} sources have historically been kept.`,
      tone: "positive",
    });
  } else if (!isVideo && tier === "S" && tierStats.rate >= 0.75) {
    insights.push({
      kind: "similar",
      text: `Similar Tier S stills have historically been kept.`,
      tone: "positive",
    });
  }

  return insights.slice(0, 4);
}
