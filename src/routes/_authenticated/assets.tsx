import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  X,
  Download,
  ExternalLink,
  Heart,
  Play,
  Pause,
  ChevronUp,
  ChevronDown,
  Sparkles,
  Clock,
  Users,
  Tag,
  Volume2,
  VolumeX,
  Brain,
  TrendingUp,
  Repeat,
  Film,
  Image as ImageIcon,
} from "lucide-react";
import { useAssets, assetActions } from "@/lib/assets-store";
import { useGlobalQuery, matchesQuery, setGlobalQuery } from "@/lib/search-store";
import { useFavorites, toggleFavorite } from "@/lib/favorites-store";
import {
  selectAsset,
  setVisibleAssets,
  useSelection,
} from "@/lib/selection-store";
import type { Asset } from "@/lib/mock-data";
import {
  computeOperatorScore,
  computeRecommendation,
  verdictToneClasses,
  rankByOperatorScore,
  scoreToneClasses,
  scoreConfidenceLabel,
  tierFor,
  TIER_META,
} from "@/lib/priority";
import { ScoreRing, TierChip } from "@/components/operator-score";
import {
  operatorInsightsFor,
  type OperatorInsight,
} from "@/lib/operator-intelligence";
import { setAmbientCalm } from "@/lib/ambient-store";
import { MissionComplete } from "@/components/mission-complete";
import { NetworkSummary } from "@/components/network-summary";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const DAYS = ["all", "today", "yesterday"] as const;
const STATUSES = ["all", "new", "approved", "ignored", "downloaded"] as const;
type Day = (typeof DAYS)[number];
type Status = (typeof STATUSES)[number];

const STATUS_LABEL: Record<Status, string> = {
  all: "All",
  new: "Awaiting",
  approved: "Kept",
  ignored: "Dismissed",
  downloaded: "Downloaded",
};

const searchSchema = z.object({
  day: fallback(z.enum(DAYS), "today").default("today"),
  status: fallback(z.enum(STATUSES), "new").default("new"),
});

export const Route = createFileRoute("/_authenticated/assets")({
  head: () => ({
    meta: [
      { title: "Asset Inbox — InstaScanner" },
      {
        name: "description",
        content:
          "Review, keep, dismiss, and download assets surfaced by the autonomous monitoring network.",
      },
    ],
  }),
  validateSearch: zodValidator(searchSchema),
  component: AssetInbox,
});

// ---- Domain helpers ----

const WATCHLIST: Record<string, string> = {
  nike: "Athletic Performance",
  adidas: "Athletic Performance",
  patagonia: "Outdoor Apparel",
  arcteryx: "Outdoor Apparel",
  carhartt: "Outdoor Apparel",
  chanelofficial: "Luxury Fashion",
  gucci: "Luxury Fashion",
  prada: "Luxury Fashion",
  louisvuitton: "Luxury Fashion",
  balenciaga: "Luxury Fashion",
  ferrari: "Automotive",
  porsche: "Automotive",
  bmw: "Automotive",
  mercedesbenz: "Automotive",
  rimac_official: "Automotive",
  apple: "Technology",
  spacex: "Aerospace",
  natgeo: "Editorial",
  off____white: "Streetwear",
  stussy: "Streetwear",
  aimeleondore: "Streetwear",
  kithnyc: "Streetwear",
  needlesofficial: "Streetwear",
  ssense: "Retail",
};
const watchlistFor = (u: string) => WATCHLIST[u] ?? "General";


function matches(a: Asset, day: Day, status: Status, q: string) {
  if (day !== "all" && a.day !== day) return false;
  if (status !== "all" && a.status !== status) return false;
  return matchesQuery(a, q);
}

function AssetInbox() {
  const { day, status } = Route.useSearch();
  const q = useGlobalQuery();
  const navigate = useNavigate({ from: "/assets" });
  const assets = useAssets();
  const favorites = useFavorites();

  const setSearch = (patch: Partial<{ day: Day; status: Status }>) =>
    navigate({
      search: (prev: { day: Day; status: Status }) => ({ ...prev, ...patch }),
      replace: true,
    });

  // Rank by Operator Score, then apply filters. Sorting first would drop
  // filtered-out assets from the ranking; sorting after keeps the visible
  // queue ordered by "what deserves attention first".
  const filtered = useMemo(() => {
    const matched = assets.filter((a) => matches(a, day, status, q));
    return rankByOperatorScore(matched, favorites);
  }, [assets, day, status, q, favorites]);

  // Register visible assets for the global selection store (keeps command
  // palette, favorites, etc. in sync). Order defines J/K navigation.
  const filteredKey = filtered.map((a) => a.id).join("|");
  useEffect(() => {
    setVisibleAssets(filtered.map((a) => a.id));
    return () => setVisibleAssets([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredKey]);

  const { selectedId } = useSelection();
  const current =
    filtered.find((a) => a.id === selectedId) ?? filtered[0] ?? null;

  const statusCounts = useMemo(() => {
    const counts: Record<Status, number> = {
      all: 0,
      new: 0,
      approved: 0,
      ignored: 0,
      downloaded: 0,
    };
    for (const a of assets) {
      if (day !== "all" && a.day !== day) continue;
      counts.all++;
      counts[a.status]++;
    }
    return counts;
  }, [assets, day]);

  // ---- Inbox-scoped keyboard shortcuts (override global A/D bindings) ----
  const advance = (delta: 1 | -1) => {
    if (!filtered.length) return;
    const idx = current ? filtered.findIndex((a) => a.id === current.id) : -1;
    const next = idx === -1 ? 0 : Math.max(0, Math.min(filtered.length - 1, idx + delta));
    const nextId = filtered[next]?.id;
    if (nextId) selectAsset(nextId);
  };

  // Session tally — powers the mission-complete panel. Reset once the panel
  // finishes so a subsequent batch of new assets can trigger it again.
  const [session, setSession] = useState({ approved: 0, dismissed: 0 });
  const [complete, setComplete] = useState(false);

  const keep = (a: Asset | null) => {
    if (!a) return;
    assetActions.approve(a.id);
    setSession((s) => ({ ...s, approved: s.approved + 1 }));
    toast.success("Kept");
    advance(1);
  };
  const dismiss = (a: Asset | null) => {
    if (!a) return;
    assetActions.ignore(a.id);
    setSession((s) => ({ ...s, dismissed: s.dismissed + 1 }));
    toast("Dismissed");
    advance(1);
  };
  const download = (a: Asset | null) => {
    if (!a) return;
    assetActions.download(a.id);
    toast.success("Download queued");
  };
  const openSource = (a: Asset | null) => {
    if (!a) return;
    window.open(`https://instagram.com/${a.username}`, "_blank", "noopener,noreferrer");
  };

  // Awaiting count across the entire inbox (independent of filter) — the
  // mission is truly complete only when nothing is left to review anywhere.
  const totalAwaiting = useMemo(
    () => assets.filter((a) => a.status === "new").length,
    [assets],
  );

  // AI verdict breakdown across the awaiting queue. Powers the calm
  // Network Summary briefing — it never hides assets, only reframes them.
  const awaitingBreakdown = useMemo(() => {
    const awaiting = assets.filter((a) => a.status === "new");
    let high = 0;
    let review = 0;
    let low = 0;
    for (const a of awaiting) {
      const v = computeRecommendation(a).verdict;
      if (v === "KEEP") high++;
      else if (v === "REVIEW") review++;
      else low++;
    }
    return { processed: awaiting.length, high, review, low };
  }, [assets]);

  // Operator can dismiss the briefing to enter full review mode. Reset the
  // dismissal whenever a fresh batch of awaiting assets arrives.
  const [briefingDismissed, setBriefingDismissed] = useState(false);
  useEffect(() => {
    setBriefingDismissed(false);
  }, [totalAwaiting === 0]);

  const showNetworkSummary =
    !briefingDismissed &&
    awaitingBreakdown.processed > 0 &&
    awaitingBreakdown.high === 0;

  const reviewRecommended = () => {
    const firstReview = filtered.find(
      (a) => a.status === "new" && computeRecommendation(a).verdict === "REVIEW",
    );
    if (firstReview) selectAsset(firstReview.id);
    setBriefingDismissed(true);
  };


  useEffect(() => {
    if (complete) return;
    if (totalAwaiting !== 0) return;
    if (session.approved + session.dismissed === 0) return;
    setComplete(true);
    setAmbientCalm(true);
  }, [totalAwaiting, session, complete]);

  const handleCompletionDone = () => {
    setComplete(false);
    setAmbientCalm(false);
    setSession({ approved: 0, dismissed: 0 });
  };

  // If the operator leaves the inbox while calm is still active, release it —
  // the Dashboard should remain fully alive.
  useEffect(() => {
    return () => setAmbientCalm(false);
  }, []);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [muted, setMuted] = useState(true);

  // Reset play state when current asset changes.
  useEffect(() => {
    setIsPlaying(true);
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.play().catch(() => {});
    }
  }, [current?.id]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => {});
      setIsPlaying(true);
    } else {
      v.pause();
      setIsPlaying(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
      )
        return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const key = e.key;
      const lower = key.toLowerCase();

      if (key === " " || key === "Spacebar") {
        e.preventDefault();
        e.stopImmediatePropagation();
        togglePlay();
        return;
      }
      if (key === "ArrowDown") {
        e.preventDefault();
        e.stopImmediatePropagation();
        advance(1);
        return;
      }
      if (key === "ArrowUp") {
        e.preventDefault();
        e.stopImmediatePropagation();
        advance(-1);
        return;
      }
      if (lower === "a") {
        e.preventDefault();
        e.stopImmediatePropagation();
        keep(current);
        return;
      }
      if (lower === "d") {
        e.preventDefault();
        e.stopImmediatePropagation();
        dismiss(current);
        return;
      }
      if (lower === "s") {
        e.preventDefault();
        e.stopImmediatePropagation();
        download(current);
        return;
      }
    };
    // capture-phase so we run before the global shortcut layer
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, filteredKey]);

  return (
    <div className="min-h-[calc(100vh-3.5rem)] w-full">
      <NetworkSummary
        visible={showNetworkSummary}
        processed={awaitingBreakdown.processed}
        highPriority={awaitingBreakdown.high}
        worthReviewing={awaitingBreakdown.review}
        lowPriority={awaitingBreakdown.low}
        onReviewRecommended={reviewRecommended}
        onReviewEverything={() => setBriefingDismissed(true)}
      />

      {/* MOBILE — swipe deck */}
      <div className="md:hidden">
        <MobileHeader
          count={filtered.filter((a) => a.status === "new").length}
          total={filtered.length}
        />
        <SwipeDeck
          assets={filtered}
          currentId={current?.id ?? null}
          onSelect={selectAsset}
          onKeep={keep}
          onDismiss={dismiss}
        />
      </div>

      {/* DESKTOP — three-pane */}
      <div className="hidden md:grid md:grid-cols-[280px_minmax(0,1fr)_320px] xl:grid-cols-[320px_minmax(0,1fr)_360px] md:h-[calc(100vh-3.5rem)]">
        <InboxRail
          assets={filtered}
          allAssets={assets}
          currentId={current?.id ?? null}
          day={day}
          status={status}
          statusCounts={statusCounts}
          onDay={(d) => setSearch({ day: d })}
          onStatus={(s) => setSearch({ status: s })}
          onSelect={selectAsset}
          onReset={() => {
            setSearch({ day: "today", status: "new" });
            setGlobalQuery("");
          }}
          query={q}
        />

        <section className="relative flex min-w-0 flex-col border-x border-border/60 bg-background/40">
          <AssetStage
            asset={current}
            videoRef={videoRef}
            isPlaying={isPlaying}
            muted={muted}
            onTogglePlay={togglePlay}
            onToggleMute={() => setMuted((m) => !m)}
            onPrev={() => advance(-1)}
            onNext={() => advance(1)}
            index={
              current ? filtered.findIndex((a) => a.id === current.id) + 1 : 0
            }
            total={filtered.length}
          />
          <ActionBar
            asset={current}
            onKeep={() => keep(current)}
            onDismiss={() => dismiss(current)}
            onDownload={() => download(current)}
            onOpenSource={() => openSource(current)}
          />
        </section>

        <IntelligencePanel
          asset={current}
          isFavorite={current ? favorites.has(current.id) : false}
          onToggleFavorite={() => current && toggleFavorite(current.id)}
        />
      </div>

      <MissionComplete
        visible={complete}
        approved={session.approved}
        dismissed={session.dismissed}
        onDone={handleCompletionDone}
      />
    </div>
  );
}

// ---------------- Inbox Rail (left) ----------------

function InboxRail({
  assets,
  allAssets,
  currentId,
  day,
  status,
  statusCounts,
  onDay,
  onStatus,
  onSelect,
  onReset,
  query,
}: {
  assets: Asset[];
  allAssets: Asset[];
  currentId: string | null;
  day: Day;
  status: Status;
  statusCounts: Record<Status, number>;
  onDay: (d: Day) => void;
  onStatus: (s: Status) => void;
  onSelect: (id: string) => void;
  onReset: () => void;
  query: string;
}) {
  const awaiting = allAssets.filter((a) => a.status === "new").length;
  return (
    <aside className="flex min-w-0 flex-col overflow-hidden bg-card/30">
      <div className="border-b border-border/60 px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Asset Inbox
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums tracking-tight">
                {awaiting}
              </span>
              <span className="text-xs text-muted-foreground">awaiting decision</span>
            </div>
          </div>
          <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-2 text-[10px] uppercase tracking-wider text-success">
            <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
            Live
          </span>
        </div>

        {/* Day pills */}
        <div className="mt-4 flex items-center gap-1 rounded-lg border border-border bg-background/60 p-0.5">
          {DAYS.map((k) => (
            <button
              key={k}
              onClick={() => onDay(k)}
              className={cn(
                "flex-1 rounded-md px-2 py-1 text-[11px] capitalize transition-colors",
                day === k
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {k}
            </button>
          ))}
        </div>

        {/* Status filter */}
        <div className="mt-2 flex flex-wrap gap-1">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => onStatus(s)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] transition-colors",
                status === s
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-background/40 text-muted-foreground hover:text-foreground",
              )}
            >
              {STATUS_LABEL[s]}
              <span className="tabular-nums opacity-70">{statusCounts[s]}</span>
            </button>
          ))}
        </div>

        {(day !== "today" || status !== "new" || query) && (
          <button
            onClick={onReset}
            className="mt-3 text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Reset filters
          </button>
        )}
      </div>

      {/* Ranking indicator */}
      <div className="flex items-center justify-between border-b border-border/60 bg-background/40 px-5 py-2 text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-1 w-1 rounded-full bg-primary" />
          Ranked by Operator Score
        </span>
        <span>{assets.length}</span>
      </div>

      {/* Queue list */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {assets.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">
            No assets in this queue. The network is monitoring.
          </div>
        ) : (
          <ol className="py-1">
            {assets.map((a) => {
              const active = a.id === currentId;
              const tier = tierFor(a.username);
              const { score } = computeOperatorScore(a, {
                isFavorite: false, // rank already accounts for favorites
              });
              const tone = scoreToneClasses(score);
              return (
                <li key={a.id}>
                  <button
                    onClick={() => onSelect(a.id)}
                    data-asset-id={a.id}
                    data-asset-url={`https://instagram.com/${a.username}`}
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors",
                      active ? "bg-primary/10" : "hover:bg-muted/40",
                    )}
                  >
                    <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-muted">
                      <img
                        src={a.thumbnail}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                      {a.video && (
                        <div className="absolute bottom-0.5 right-0.5 rounded-sm bg-black/70 px-1 py-[1px] text-[8px] font-medium uppercase text-white">
                          Vid
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <TierChip tier={tier} size="xs" />
                        <span
                          className={cn(
                            "truncate text-xs font-medium",
                            active ? "text-primary" : "text-foreground",
                          )}
                        >
                          @{a.username}
                        </span>
                        <StatusDot status={a.status} />
                      </div>
                      <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                        {watchlistFor(a.username)} · {a.detectedAt}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "inline-flex h-6 shrink-0 items-center rounded-md border px-1.5 text-[10px] font-semibold tabular-nums",
                        tone.border,
                        tone.bg,
                        tone.text,
                      )}
                      title={`Operator Score · ${scoreConfidenceLabel(score)}`}
                    >
                      {score}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </aside>
  );
}

function StatusDot({ status }: { status: Asset["status"] }) {
  const cls =
    status === "new"
      ? "bg-primary"
      : status === "approved"
        ? "bg-success"
        : status === "downloaded"
          ? "bg-success/60"
          : "bg-muted-foreground/50";
  return <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", cls)} />;
}

// ---------------- Asset Stage (center) ----------------

function AssetStage({
  asset,
  videoRef,
  isPlaying,
  muted,
  onTogglePlay,
  onToggleMute,
  onPrev,
  onNext,
  index,
  total,
}: {
  asset: Asset | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isPlaying: boolean;
  muted: boolean;
  onTogglePlay: () => void;
  onToggleMute: () => void;
  onPrev: () => void;
  onNext: () => void;
  index: number;
  total: number;
}) {
  if (!asset) {
    return (
      <div className="flex flex-1 items-center justify-center p-10">
        <div className="text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-full border border-border bg-card">
            <Sparkles className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="mt-3 text-sm font-medium">Inbox clear</div>
          <div className="mt-1 text-xs text-muted-foreground">
            The network is monitoring. New assets will appear here.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* Stage header */}
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <img
            src={asset.avatar}
            alt=""
            className="h-8 w-8 shrink-0 rounded-full border border-border"
          />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <TierChip tier={tierFor(asset.username)} size="xs" />
              <span className="truncate text-sm font-medium">@{asset.username}</span>
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              {watchlistFor(asset.username)} · {asset.detectedAt}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <ScoreRing score={computeOperatorScore(asset).score} size={40} showLabel />
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <button
              onClick={onPrev}
              className="grid h-7 w-7 place-items-center rounded-md border border-border bg-background/60 hover:border-primary/40 hover:text-foreground"
              title="Previous asset (↑)"
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <span className="min-w-[52px] px-1 text-center tabular-nums">
              {index} / {total}
            </span>
            <button
              onClick={onNext}
              className="grid h-7 w-7 place-items-center rounded-md border border-border bg-background/60 hover:border-primary/40 hover:text-foreground"
              title="Next asset (↓)"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Media surface */}
      <div
        onClick={asset.video ? onTogglePlay : undefined}
        className={cn(
          "relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[radial-gradient(ellipse_at_center,hsl(var(--muted)/0.25),transparent_70%)] p-4 md:p-6",
          asset.video && "cursor-pointer",
        )}
      >
        {asset.video ? (
          <>
            <video
              ref={videoRef}
              key={asset.id}
              src={asset.video}
              poster={asset.thumbnail}
              autoPlay
              muted={muted}
              loop
              playsInline
              className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
            />
            {!isPlaying && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <div className="grid h-16 w-16 place-items-center rounded-full border border-white/30 bg-black/40 backdrop-blur">
                  <Play className="h-6 w-6 translate-x-0.5 text-white" />
                </div>
              </div>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleMute();
              }}
              className="absolute bottom-4 right-4 grid h-9 w-9 place-items-center rounded-full border border-border bg-background/70 backdrop-blur hover:border-primary/40"
              title="Toggle mute"
            >
              {muted ? (
                <VolumeX className="h-4 w-4" />
              ) : (
                <Volume2 className="h-4 w-4" />
              )}
            </button>
          </>
        ) : (
          <img
            src={asset.thumbnail}
            alt=""
            className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
          />
        )}
      </div>

      {/* Caption strip */}
      <div className="border-t border-border/60 px-5 py-3">
        <p className="line-clamp-2 text-sm text-foreground/90">{asset.caption}</p>
      </div>
    </div>
  );
}

// ---------------- Action Bar ----------------

function ActionBar({
  asset,
  onKeep,
  onDismiss,
  onDownload,
  onOpenSource,
}: {
  asset: Asset | null;
  onKeep: () => void;
  onDismiss: () => void;
  onDownload: () => void;
  onOpenSource: () => void;
}) {
  const disabled = !asset;
  return (
    <div className="grid shrink-0 grid-cols-4 gap-2 border-t border-border/60 bg-card/40 px-4 py-3 sm:px-5">
      <ActionButton
        onClick={onDismiss}
        disabled={disabled}
        shortcut="D"
        variant="danger"
        icon={<X className="h-4 w-4" />}
        label="Dismiss"
      />
      <ActionButton
        onClick={onKeep}
        disabled={disabled}
        shortcut="A"
        variant="success"
        icon={<Check className="h-4 w-4" />}
        label="Keep"
      />
      <ActionButton
        onClick={onDownload}
        disabled={disabled}
        shortcut="S"
        variant="primary"
        icon={<Download className="h-4 w-4" />}
        label="Download"
      />
      <ActionButton
        onClick={onOpenSource}
        disabled={disabled}
        variant="ghost"
        icon={<ExternalLink className="h-4 w-4" />}
        label="Open Source"
      />
    </div>
  );
}

function ActionButton({
  onClick,
  disabled,
  shortcut,
  variant,
  icon,
  label,
}: {
  onClick: () => void;
  disabled?: boolean;
  shortcut?: string;
  variant: "success" | "danger" | "primary" | "ghost";
  icon: React.ReactNode;
  label: string;
}) {
  const styles: Record<typeof variant, string> = {
    success:
      "border-success/40 bg-success/10 text-success hover:bg-success/20 hover:border-success/60",
    danger:
      "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20 hover:border-destructive/60",
    primary:
      "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 hover:border-primary/60",
    ghost:
      "border-border bg-background/40 text-foreground/80 hover:bg-muted/40 hover:text-foreground",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "group inline-flex h-10 items-center justify-center gap-2 rounded-lg border text-xs font-medium uppercase tracking-[0.12em] transition-all disabled:cursor-not-allowed disabled:opacity-40",
        styles[variant],
      )}
      title={shortcut ? `${label} (${shortcut})` : label}
    >
      {icon}
      <span>{label}</span>
      {shortcut && (
        <span className="ml-0.5 hidden rounded border border-current/40 px-1 text-[9px] tabular-nums opacity-70 lg:inline">
          {shortcut}
        </span>
      )}
    </button>
  );
}

// ---------------- Intelligence Panel (right) ----------------

function IntelligencePanel({
  asset,
  isFavorite,
  onToggleFavorite,
}: {
  asset: Asset | null;
  isFavorite: boolean;
  onToggleFavorite: () => void;
}) {
  if (!asset) {
    return (
      <aside className="hidden min-w-0 border-l border-border/60 bg-card/30 p-5 md:block">
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Asset Intelligence
        </div>
        <div className="mt-6 text-xs text-muted-foreground">
          Select an asset to view intelligence.
        </div>
      </aside>
    );
  }

  return (
    <aside className="hidden min-w-0 flex-col overflow-y-auto border-l border-border/60 bg-card/30 md:flex">
      <div className="border-b border-border/60 px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Asset Intelligence
          </div>
          <button
            onClick={onToggleFavorite}
            className={cn(
              "grid h-7 w-7 place-items-center rounded-md border transition-colors",
              isFavorite
                ? "border-warning/40 bg-warning/10 text-warning"
                : "border-border bg-background/40 text-muted-foreground hover:text-foreground",
            )}
            title="Toggle favorite (F)"
          >
            <Heart className={cn("h-3.5 w-3.5", isFavorite && "fill-warning")} />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-5 px-5 py-5">
        <RecommendationCard asset={asset} isFavorite={isFavorite} />
        <OperatorInsightCard asset={asset} />

        <IntelField label="Account" icon={Users}>
          <div className="flex items-center gap-2">
            <img
              src={asset.avatar}
              alt=""
              className="h-6 w-6 shrink-0 rounded-full border border-border"
            />
            <span className="truncate text-sm font-medium">@{asset.username}</span>
          </div>
        </IntelField>

        <IntelField label="Watchlist" icon={Tag}>
          <div className="flex flex-wrap items-center gap-2">
            <TierChip tier={tierFor(asset.username)} size="sm" showLabel />
            <span className="text-[11px] text-muted-foreground">
              · {watchlistFor(asset.username)}
            </span>
          </div>
        </IntelField>

        <OperatorScoreField asset={asset} isFavorite={isFavorite} />

        <IntelField label="Published" icon={Clock}>
          <span className="text-sm tabular-nums">{asset.detectedAt}</span>
        </IntelField>

        <IntelField label="Likes" icon={Heart}>
          <span className="text-sm tabular-nums">{asset.likes}</span>
        </IntelField>
      </div>

      <div className="mt-auto border-t border-border/60 px-5 py-4 text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
        Shortcuts: <span className="text-foreground/80">Space</span> play ·{" "}
        <span className="text-foreground/80">A</span> keep ·{" "}
        <span className="text-foreground/80">D</span> dismiss ·{" "}
        <span className="text-foreground/80">S</span> download
      </div>
    </aside>
  );
}

function RecommendationCard({
  asset,
  isFavorite,
}: {
  asset: Asset;
  isFavorite: boolean;
}) {
  const rec = computeRecommendation(asset, { isFavorite });
  const tone = verdictToneClasses(rec.verdict);
  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        tone.border,
        tone.bg,
      )}
    >
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        <Sparkles className="h-3 w-3" />
        Recommendation
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 rounded-full", tone.dot)} />
          <span className={cn("text-2xl font-semibold tracking-tight", tone.text)}>
            {rec.verdict}
          </span>
        </div>
        <div className="text-right">
          <div className={cn("text-lg font-semibold tabular-nums", tone.text)}>
            {rec.confidence}%
          </div>
          <div className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
            Confidence
          </div>
        </div>
      </div>
      <div className="mt-3 text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
        Reasoning
      </div>
      <ul className="mt-1.5 space-y-1">
        {rec.reasons.map((r, i) => (
          <li
            key={i}
            className="flex gap-2 text-[12px] leading-snug text-foreground/85"
          >
            <span className={cn("mt-1.5 h-1 w-1 shrink-0 rounded-full", tone.dot)} />
            <span>{r}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 border-t border-border/40 pt-2 text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
        AI recommends · <span className="text-foreground/80">Operator decides</span>
      </div>
    </div>
  );
}

function OperatorInsightCard({ asset }: { asset: Asset }) {
  const liveAssets = useAssets();
  const insights = useMemo(
    () => operatorInsightsFor(asset, liveAssets),
    [asset, liveAssets],
  );

  return (
    <div className="rounded-lg border border-border/70 bg-background/40 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-primary">
          <Brain className="h-3 w-3" />
          Operator Insight
        </div>
        <span className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground">
          Learned from your history
        </span>
      </div>

      {insights.length === 0 ? (
        <div className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          Not enough personal history for @{asset.username} yet. Operator
          Intelligence is learning from your decisions.
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {insights.map((ins, i) => (
            <InsightRow key={i} insight={ins} />
          ))}
        </ul>
      )}

      <div className="mt-3 border-t border-border/40 pt-2 text-[9px] uppercase tracking-[0.15em] text-muted-foreground">
        Only your decisions · never global trends
      </div>
    </div>
  );
}

function InsightRow({ insight }: { insight: OperatorInsight }) {
  const tone =
    insight.tone === "positive"
      ? "text-success"
      : insight.tone === "caution"
        ? "text-warning"
        : "text-foreground/80";
  const dotTone =
    insight.tone === "positive"
      ? "bg-success"
      : insight.tone === "caution"
        ? "bg-warning"
        : "bg-muted-foreground";
  const Icon =
    insight.kind === "creator"
      ? Users
      : insight.kind === "watchlist"
        ? TrendingUp
        : insight.kind === "repost"
          ? Repeat
          : insight.kind === "download"
            ? Download
            : insight.kind === "format"
              ? insight.text.toLowerCase().includes("video")
                ? Film
                : ImageIcon
              : Sparkles;

  return (
    <li className="flex gap-2.5">
      <span className="mt-1.5 flex items-center gap-1.5">
        <span className={cn("h-1 w-1 shrink-0 rounded-full", dotTone)} />
        <Icon className={cn("h-3 w-3 shrink-0", tone)} />
      </span>
      <span className="text-[12px] leading-snug text-foreground/85">
        {insight.text}
      </span>
    </li>
  );
}



function IntelField({
  label,
  icon: Icon,
  children,
  accent,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em]",
          accent ? "text-primary" : "text-muted-foreground",
        )}
      >
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function OperatorScoreField({
  asset,
  isFavorite,
}: {
  asset: Asset;
  isFavorite: boolean;
}) {
  const { score, factors } = computeOperatorScore(asset, { isFavorite });
  const tone = scoreToneClasses(score);
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] text-primary">
        <Sparkles className="h-3 w-3" />
        Operator Score
      </div>
      <div className="mt-2 flex items-center gap-3">
        <ScoreRing score={score} size={56} />
        <div className="min-w-0">
          <div className={cn("text-xs font-medium", tone.text)}>
            {scoreConfidenceLabel(score)}
          </div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            Confidence · updated live
          </div>
        </div>
      </div>
      <ul className="mt-3 space-y-1.5">
        {factors.map((f) => (
          <li key={f.key}>
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span className="uppercase tracking-wider">{f.label}</span>
              <span className="tabular-nums text-foreground/70">
                {Math.round(f.value)}
                <span className="text-muted-foreground/60"> · {f.weight}%</span>
              </span>
            </div>
            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted/40">
              <div
                className={cn("h-full", tone.text.replace("text-", "bg-"))}
                style={{ width: `${Math.max(2, Math.round(f.value))}%` }}
              />
            </div>
            {f.note && (
              <div className="mt-0.5 truncate text-[10px] text-muted-foreground/70">
                {f.note}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------- Mobile: Swipe Deck ----------------

function MobileHeader({ count, total }: { count: number; total: number }) {
  return (
    <div className="sticky top-14 z-10 flex items-center justify-between border-b border-border/60 bg-background/80 px-4 py-2.5 backdrop-blur">
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Asset Inbox
        </div>
        <div className="mt-0.5 truncate text-sm font-medium">
          <span className="tabular-nums">{count}</span> awaiting · {total} total
        </div>
      </div>
      <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-2 text-[10px] uppercase tracking-wider text-success">
        <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
        Live
      </span>
    </div>
  );
}

function SwipeDeck({
  assets,
  currentId,
  onSelect,
  onKeep,
  onDismiss,
}: {
  assets: Asset[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onKeep: (a: Asset) => void;
  onDismiss: (a: Asset) => void;
}) {
  const idx = useMemo(() => {
    if (!currentId) return 0;
    const i = assets.findIndex((a) => a.id === currentId);
    return i === -1 ? 0 : i;
  }, [assets, currentId]);

  const current = assets[idx];
  const next = assets[idx + 1];

  if (!current) {
    return (
      <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center p-8 text-center">
        <div>
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-full border border-border bg-card">
            <Sparkles className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="mt-3 text-sm font-medium">Inbox clear</div>
          <div className="mt-1 text-xs text-muted-foreground">
            The network is monitoring.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative mx-auto mt-3 h-[calc(100vh-10rem)] w-full max-w-md px-4">
      {next && <UnderCard asset={next} />}
      <SwipeCard
        key={current.id}
        asset={current}
        onKeep={() => onKeep(current)}
        onDismiss={() => onDismiss(current)}
        onNext={() => {
          const n = assets[idx + 1];
          if (n) onSelect(n.id);
        }}
      />
    </div>
  );
}

function UnderCard({ asset }: { asset: Asset }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-4 top-0 h-full origin-bottom scale-[0.96] overflow-hidden rounded-2xl border border-border bg-card opacity-70"
    >
      <img
        src={asset.thumbnail}
        alt=""
        className="h-full w-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
    </div>
  );
}

function SwipeCard({
  asset,
  onKeep,
  onDismiss,
  onNext,
}: {
  asset: Asset;
  onKeep: () => void;
  onDismiss: () => void;
  onNext: () => void;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  const [exiting, setExiting] = useState<"left" | "right" | "up" | null>(null);
  const [playing, setPlaying] = useState(true);

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-no-swipe]")) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    start.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    setDrag({ x: 0, y: 0 });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    setDrag({ x: e.clientX - start.current.x, y: e.clientY - start.current.y });
  };
  const commitExit = (dir: "left" | "right" | "up") => {
    setExiting(dir);
    setTimeout(() => {
      if (dir === "right") onKeep();
      else if (dir === "left") onDismiss();
      else onNext();
    }, 220);
  };
  const onPointerUp = () => {
    if (!drag || !start.current) return;
    const dt = Date.now() - start.current.t;
    const { x, y } = drag;
    start.current = null;
    // Tap: no significant movement
    if (Math.abs(x) < 8 && Math.abs(y) < 8 && dt < 250) {
      if (asset.video && videoRef.current) {
        const v = videoRef.current;
        if (v.paused) {
          v.play().catch(() => {});
          setPlaying(true);
        } else {
          v.pause();
          setPlaying(false);
        }
      }
      setDrag(null);
      return;
    }
    const thresholdX = 100;
    const thresholdY = 100;
    if (x > thresholdX) return commitExit("right");
    if (x < -thresholdX) return commitExit("left");
    if (y < -thresholdY) return commitExit("up");
    setDrag(null);
  };

  const dx = drag?.x ?? 0;
  const dy = drag?.y ?? 0;
  const rot = dx / 20;
  const style: React.CSSProperties = exiting
    ? {
        transform:
          exiting === "right"
            ? "translate(120%, 0) rotate(18deg)"
            : exiting === "left"
              ? "translate(-120%, 0) rotate(-18deg)"
              : "translate(0, -120%)",
        transition: "transform 220ms ease-out, opacity 220ms ease-out",
        opacity: 0,
      }
    : drag
      ? {
          transform: `translate(${dx}px, ${dy}px) rotate(${rot}deg)`,
        }
      : { transition: "transform 200ms ease-out" };

  const keepOpacity = Math.max(0, Math.min(1, dx / 120));
  const dismissOpacity = Math.max(0, Math.min(1, -dx / 120));
  const nextOpacity = Math.max(0, Math.min(1, -dy / 120));

  return (
    <div
      ref={cardRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={style}
      className="absolute inset-x-4 top-0 h-full touch-none select-none overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
    >
      {asset.video ? (
        <video
          ref={videoRef}
          src={asset.video}
          poster={asset.thumbnail}
          autoPlay
          muted
          loop
          playsInline
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <img
          src={asset.thumbnail}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-black/40" />

      {/* Play indicator when paused */}
      {asset.video && !playing && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="grid h-16 w-16 place-items-center rounded-full border border-white/30 bg-black/40 backdrop-blur">
            <Play className="h-6 w-6 translate-x-0.5 text-white" />
          </div>
        </div>
      )}

      {/* Overlays */}
      <div
        className="pointer-events-none absolute left-4 top-4 rounded-md border border-destructive/60 bg-destructive/20 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-destructive"
        style={{ opacity: dismissOpacity, transform: "rotate(-6deg)" }}
      >
        Dismiss
      </div>
      <div
        className="pointer-events-none absolute right-4 top-4 rounded-md border border-success/60 bg-success/20 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-success"
        style={{ opacity: keepOpacity, transform: "rotate(6deg)" }}
      >
        Keep
      </div>
      <div
        className="pointer-events-none absolute inset-x-0 top-16 flex justify-center"
        style={{ opacity: nextOpacity }}
      >
        <div className="rounded-md border border-primary/60 bg-primary/20 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-primary">
          Next
        </div>
      </div>

      {/* Score badge — top-right */}
      <div className="absolute right-3 top-3">
        <div className="rounded-lg border border-white/25 bg-black/40 p-1 backdrop-blur">
          <ScoreRing score={computeOperatorScore(asset).score} size={40} />
        </div>
      </div>

      {/* Info footer */}
      <div className="absolute inset-x-0 bottom-0 p-4 text-white">
        <div className="flex items-center gap-2">
          <img
            src={asset.avatar}
            alt=""
            className="h-8 w-8 shrink-0 rounded-full border border-white/40"
          />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <TierChip tier={tierFor(asset.username)} size="xs" />
              <span className="truncate text-sm font-semibold">@{asset.username}</span>
            </div>
            <div className="truncate text-[11px] text-white/70">
              {watchlistFor(asset.username)} · {asset.detectedAt}
            </div>
          </div>
        </div>
        <p className="mt-2 line-clamp-2 text-[13px] text-white/90">{asset.caption}</p>
        {(() => {
          const rec = computeRecommendation(asset);
          const tone = verdictToneClasses(rec.verdict);
          return (
            <div
              className={cn(
                "mt-3 flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 backdrop-blur",
                tone.border,
                tone.bg,
              )}
            >
              <div className="flex items-center gap-1.5">
                <Sparkles className={cn("h-3 w-3", tone.text)} />
                <span
                  className={cn(
                    "text-[11px] font-semibold uppercase tracking-[0.18em]",
                    tone.text,
                  )}
                >
                  {rec.verdict}
                </span>
                <span className="text-[10px] uppercase tracking-[0.15em] text-white/60">
                  · {rec.reasons[0]}
                </span>
              </div>
              <span className={cn("text-[11px] font-semibold tabular-nums", tone.text)}>
                {rec.confidence}%
              </span>
            </div>
          );
        })()}
      </div>

      {/* Bottom quick-actions */}
      <div
        data-no-swipe
        className="absolute inset-x-0 bottom-0 flex translate-y-full justify-center gap-3 p-4"
      >
        {/* hidden — real controls below outside the card in mobile view */}
      </div>
    </div>
  );
}
