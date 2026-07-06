import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Sparkles,
  Check,
  Ban,
  X,
  ExternalLink,
  Loader2,
  RefreshCw,
  Activity,
  ShieldCheck,
  Gauge,
  ChevronDown,
  ChevronRight,
  Anchor,
  Users,

} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/kpi-card";
import { cn } from "@/lib/utils";
import {
  listDiscoveryCandidatesFn,
  getDiscoveryStatsFn,
  decideDiscoveryCandidateFn,
  runDiscoveryNowFn,
  type DiscoveryCandidateRow,
  type DiscoveredViaHop,
  type ClusterPeer,
  type ScoreReasons,
  type RankBreakdown,
} from "@/lib/discovery.functions";




export const Route = createFileRoute("/_authenticated/discovery")({
  head: () => ({
    meta: [
      { title: "Discovery — InstaScanner" },
      {
        name: "description",
        content:
          "Autonomous discovery of new high-quality Instagram accounts derived from your tracked network.",
      },
    ],
  }),
  component: DiscoveryPage,
});

const STATES = [
  { key: "new", label: "New" },
  { key: "tracked", label: "Tracked" },
  { key: "ignored", label: "Ignored" },
  { key: "blacklisted", label: "Blacklisted" },
] as const;

type StateKey = (typeof STATES)[number]["key"];

const candidatesKey = (state: StateKey) => ["discovery_candidates", state] as const;

function DiscoveryPage() {
  const [state, setState] = useState<StateKey>("new");
  const [foldClusters, setFoldClusters] = useState(true);
  const [hideBelowFloor, setHideBelowFloor] = useState(false);


  const listFn = useServerFn(listDiscoveryCandidatesFn);
  const statsFn = useServerFn(getDiscoveryStatsFn);
  const decideFn = useServerFn(decideDiscoveryCandidateFn);
  const runNowFn = useServerFn(runDiscoveryNowFn);
  const qc = useQueryClient();

  const { data: candidates = [], isLoading } = useQuery({
    queryKey: candidatesKey(state),
    queryFn: () => listFn({ data: { state } }),
    refetchInterval: 60_000,
  });
  const { data: stats } = useQuery({
    queryKey: ["discovery_stats"],
    queryFn: () => statsFn(),
    refetchInterval: 60_000,
  });

  const decide = useMutation({
    mutationFn: (input: { id: string; decision: "track" | "ignore" | "blacklist" }) =>
      decideFn({ data: input }),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: ["discovery_candidates"] });
      qc.invalidateQueries({ queryKey: ["discovery_stats"] });
      const cand = candidates.find((c) => c.id === vars.id);
      const label =
        vars.decision === "track"
          ? "Now tracking"
          : vars.decision === "ignore"
            ? "Ignored"
            : "Blacklisted";
      toast.success(`${label} @${cand?.username ?? ""}`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Decision failed"),
  });

  const [running, setRunning] = useState(false);
  async function handleRunNow() {
    if (running) return;
    setRunning(true);
    const t = toast.loading("Sweeping tracked network for new candidates…");
    try {
      const r = await runNowFn({ data: { limit: 8 } });
      qc.invalidateQueries({ queryKey: ["discovery_candidates"] });
      qc.invalidateQueries({ queryKey: ["discovery_stats"] });
      toast.success(
        `Sweep complete · ${r.seeded_candidates} signal${r.seeded_candidates === 1 ? "" : "s"} · ${r.enriched} newly analyzed`,
        { id: t },
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sweep failed", { id: t });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="p-6 md:p-8 space-y-6">
      <PageHeader
        eyebrow="Discovery engine"
        title="Discovery Inbox"
        description="New Instagram accounts surfaced by the autonomous network. Approve to promote, ignore to move on, blacklist to permanently silence."
        status={{ label: "Learning", tone: "success", live: true }}
        actions={
          <Button onClick={handleRunNow} disabled={running} className="gap-1.5">
            {running ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {running ? "Sweeping…" : "Run discovery now"}
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="New candidates" value={stats?.new_count ?? 0} icon={Sparkles} />
        <KpiCard label="Tracked via discovery" value={stats?.tracked_count ?? 0} icon={ShieldCheck} />
        <KpiCard label="Ignored" value={stats?.ignored_count ?? 0} icon={Activity} />
        <KpiCard
          label="Avg confidence"
          value={`${Math.round((stats?.avg_confidence ?? 0) * 100)}%`}
          icon={Gauge}
        />
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1 w-fit">
          {STATES.map((s) => (
            <button
              key={s.key}
              onClick={() => setState(s.key)}
              className={cn(
                "px-3 h-8 text-xs rounded-md capitalize transition-colors",
                state === s.key
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        {state === "new" && (
          <button
            onClick={() => setFoldClusters((v) => !v)}
            className={cn(
              "inline-flex items-center gap-1.5 h-8 px-3 rounded-md border text-xs transition-colors",
              foldClusters
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
            title="Fold friend groups behind their top-ranked representative"
          >
            <Users className="h-3.5 w-3.5" />
            {foldClusters ? "Clusters folded" : "Show all"}
          </button>
        )}
        {state === "new" && (
          <button
            onClick={() => setHideBelowFloor((v) => !v)}
            className={cn(
              "inline-flex items-center gap-1.5 h-8 px-3 rounded-md border text-xs transition-colors",
              hideBelowFloor
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
            title="Hide candidates that don't clear the entropy floor. Off by default — visible so you can audit the cutoff."
          >
            <Gauge className="h-3.5 w-3.5" />
            {hideBelowFloor ? "Hiding below floor" : "Show all scores"}
          </button>
        )}
      </div>

      {(() => {
        const clusterFiltered =
          state === "new" && foldClusters
            ? candidates.filter((c) => c.is_cluster_representative)
            : candidates;
        const visible =
          state === "new" && hideBelowFloor
            ? clusterFiltered.filter((c) => c.rank_breakdown?.passes_entropy)
            : clusterFiltered;
        const hidden = candidates.length - visible.length;
        return (
          <>
            {hidden > 0 && (
              <div className="text-[11px] text-muted-foreground">
                {hidden} candidate{hidden === 1 ? "" : "s"} hidden by cluster / entropy filters.
              </div>
            )}

            {isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Reading discovery graph…
              </div>
            ) : visible.length === 0 ? (
              <EmptyState state={state} />
            ) : (
              <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                {visible.map((c) => (
                  <CandidateCard
                    key={c.id}
                    candidate={c}
                    busy={decide.isPending && decide.variables?.id === c.id}
                    onDecide={(decision) => decide.mutate({ id: c.id, decision })}
                  />
                ))}
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
}


function EmptyState({ state }: { state: StateKey }) {
  const copy: Record<StateKey, { title: string; body: string }> = {
    new: {
      title: "Network scanning",
      body: "Discovery has not surfaced any new candidates yet. The engine derives new accounts from the mentions and collaborators of your tracked network — the more you track, the faster it learns.",
    },
    tracked: {
      title: "No promotions yet",
      body: "Approve a candidate as tracked and it will appear in your surveillance fleet.",
    },
    ignored: {
      title: "Nothing set aside",
      body: "Candidates you ignore appear here — nothing is ever deleted.",
    },
    blacklisted: {
      title: "No accounts silenced",
      body: "Blacklisted usernames are never resurfaced by discovery.",
    },
  };
  const c = copy[state];
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/40 p-8 text-center">
      <Sparkles className="h-6 w-6 text-primary mx-auto mb-2" />
      <div className="text-sm font-medium">{c.title}</div>
      <p className="mt-1 text-xs text-muted-foreground max-w-md mx-auto">{c.body}</p>
    </div>
  );
}

function CandidateCard({
  candidate,
  busy,
  onDecide,
}: {
  candidate: DiscoveryCandidateRow;
  busy: boolean;
  onDecide: (d: "track" | "ignore" | "blacklist") => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const headlineLines = candidate.headline_signals ?? [];
  const scoreChips = buildScoreChips(candidate);
  const confidencePct = Math.round((candidate.confidence ?? 0) * 100);
  const reasons = candidate.score_reasons ?? {};
  const hasReasoning =
    Boolean(candidate.ai_summary) ||
    Object.values(reasons).some((arr) => arr && arr.length > 0);

  return (
    <div className="rounded-xl border border-border bg-card flex flex-col">
      {/* Header — identity + confidence */}
      <div className="flex items-start gap-3 p-4 pb-3">
        {candidate.avatar_url ? (
          <img
            src={candidate.avatar_url}
            alt=""
            className="h-10 w-10 rounded-full object-cover ring-1 ring-border"
          />
        ) : (
          <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center text-xs font-medium">
            {candidate.username.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <a
              href={`https://instagram.com/${candidate.username}/`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-semibold truncate hover:text-primary"
            >
              @{candidate.username}
            </a>
            {candidate.is_verified && (
              <span className="text-[10px] text-primary" title="Verified">●</span>
            )}
            {candidate.cluster_size > 1 && (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary tabular-nums"
                title={`Part of a friend group with ${candidate.cluster_size - 1} similar account${candidate.cluster_size - 1 === 1 ? "" : "s"}`}
              >
                <Users className="h-3 w-3" />
                {candidate.cluster_size}
              </span>
            )}

            <a
              href={`https://instagram.com/${candidate.username}/`}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto text-muted-foreground hover:text-foreground"
              title="Open on Instagram"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
          {candidate.full_name && (
            <div className="text-xs text-muted-foreground truncate">{candidate.full_name}</div>
          )}
        </div>
      </div>

      {/* Provenance chain — where in the tracked network this account emerged */}
      {candidate.discovered_via && candidate.discovered_via.length > 0 && (
        <DiscoveredViaChain hops={candidate.discovered_via} depth={candidate.depth ?? 0} />
      )}


      {/* Signal stack — the "why track this?" answer in <3s */}
      <div className="px-4 space-y-1.5">
        {headlineLines.length === 0 ? (
          <div className="text-[11px] italic text-muted-foreground">
            {candidate.last_ai_at ? "No strong signals yet" : "Analyzing…"}
          </div>
        ) : (
          headlineLines.map((line, i) => (
            <div key={i} className="flex items-center gap-2 text-[12px] text-foreground/90">
              <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              <span className="truncate">{line}</span>
            </div>
          ))
        )}
      </div>

      {/* Score chips row */}
      {scoreChips.length > 0 && (
        <div className="px-4 pt-3 flex flex-wrap gap-1.5">
          {scoreChips.map((c) => (
            <ScoreChip key={c.label} label={c.label} value={c.value} tone={c.tone} />
          ))}
        </div>
      )}

      {/* Confidence + signal count strip */}
      <div className="px-4 pt-3 flex items-center gap-3 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>
          Confidence <span className="tabular-nums text-foreground/70">{confidencePct}%</span>
        </span>
        <span className="text-border">·</span>
        <span>
          {candidate.signal_count} signal{candidate.signal_count === 1 ? "" : "s"}
        </span>
      </div>

      {/* Ranking breakdown — transparent modifiers per candidate */}
      {candidate.rank_breakdown && <RankingPanel breakdown={candidate.rank_breakdown} />}


      {/* Show reasoning toggle */}
      {hasReasoning && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mx-4 mt-3 flex items-center justify-between gap-2 text-[11px] text-muted-foreground hover:text-foreground border-t border-border/60 pt-3"
        >
          <span>Show reasoning</span>
          <ChevronDown
            className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")}
          />
        </button>
      )}

      {expanded && hasReasoning && (
        <div className="px-4 pt-3 space-y-3">
          {candidate.ai_summary && (
            <p className="text-[12px] leading-relaxed text-foreground/80">
              {candidate.ai_summary}
            </p>
          )}
          <ScoreReasonsBlock reasons={reasons} candidate={candidate} />
          {candidate.cluster_peers.length > 0 && (
            <ClusterPeersBlock peers={candidate.cluster_peers} />
          )}
        </div>
      )}


      {/* Actions */}
      {candidate.state === "new" && (
        <div className="grid grid-cols-3 gap-1.5 p-4 pt-4">
          <Button
            size="sm"
            variant="outline"
            className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
            onClick={() => onDecide("track")}
            disabled={busy}
          >
            <Check className="h-3.5 w-3.5 mr-1" /> Track
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onDecide("ignore")}
            disabled={busy}
          >
            <X className="h-3.5 w-3.5 mr-1" /> Ignore
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-destructive/30 text-destructive hover:bg-destructive/10"
            onClick={() => onDecide("blacklist")}
            disabled={busy}
          >
            <Ban className="h-3.5 w-3.5 mr-1" /> Block
          </Button>
        </div>
      )}
    </div>
  );
}

type ChipTone = "elite" | "strong" | "neutral";

function ScoreChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: ChipTone;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium tabular-nums border",
        tone === "elite" && "border-emerald-500/30 text-emerald-300 bg-emerald-500/10",
        tone === "strong" && "border-primary/30 text-primary bg-primary/10",
        tone === "neutral" && "border-border text-muted-foreground bg-background/40",
      )}
    >
      <span>{label}</span>
      <span>{value}</span>
    </span>
  );
}

function buildScoreChips(c: DiscoveryCandidateRow) {
  const chips: Array<{ label: string; value: number; tone: ChipTone }> = [];
  const push = (label: string, v: number | null) => {
    if (typeof v !== "number") return;
    const tone: ChipTone = v >= 90 ? "elite" : v >= 75 ? "strong" : "neutral";
    chips.push({ label, value: v, tone });
  };
  push("Luxury", c.luxury_score);
  push("Aesthetic", c.aesthetic_score);
  push("Quality", c.quality_score);
  push("Travel", c.travel_score);
  push("Auth.", c.authenticity_score);
  if (typeof c.p_private_individual === "number") {
    const pct = Math.round(c.p_private_individual * 100);
    if (pct >= 60) {
      chips.push({
        label: "Private",
        value: pct,
        tone: pct >= 85 ? "elite" : "strong",
      });
    }
  }
  // sort highest-scoring first, cap at 5
  return chips.sort((a, b) => b.value - a.value).slice(0, 5);
}

const AXIS_LABELS: Record<keyof ScoreReasons, string> = {
  luxury: "Luxury",
  quality: "Quality",
  aesthetic: "Aesthetic",
  travel: "Travel",
  authenticity: "Authenticity",
};

function ScoreReasonsBlock({
  reasons,
  candidate,
}: {
  reasons: ScoreReasons;
  candidate: DiscoveryCandidateRow;
}) {
  const scoreFor: Record<keyof ScoreReasons, number | null> = {
    luxury: candidate.luxury_score,
    quality: candidate.quality_score,
    aesthetic: candidate.aesthetic_score,
    travel: candidate.travel_score,
    authenticity: candidate.authenticity_score,
  };
  const axes = (Object.keys(AXIS_LABELS) as Array<keyof ScoreReasons>).filter(
    (k) => (reasons[k]?.length ?? 0) > 0,
  );
  if (axes.length === 0) return null;
  return (
    <div className="space-y-2.5">
      {axes.map((k) => (
        <div key={k}>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {AXIS_LABELS[k]}
            </span>
            <span className="text-xs font-medium tabular-nums text-foreground/80">
              {scoreFor[k] ?? "—"}
            </span>
          </div>
          <ul className="space-y-0.5 pl-3">
            {(reasons[k] ?? []).map((r, i) => (
              <li
                key={i}
                className="relative text-[11px] text-foreground/75 leading-snug before:content-['•'] before:absolute before:-left-3 before:text-muted-foreground"
              >
                {r}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function DiscoveredViaChain({ hops, depth }: { hops: DiscoveredViaHop[]; depth: number }) {
  if (!hops.length) return null;
  return (
    <div className="mx-4 mt-3 flex items-center gap-1 rounded-md border border-border/60 bg-background/40 px-2 py-1.5 text-[10px] text-muted-foreground overflow-hidden">
      <span className="uppercase tracking-wider mr-1 shrink-0">Discovered via</span>
      <div className="flex items-center gap-1 min-w-0">
        {hops.map((hop, i) => (
          <div key={hop.id} className="flex items-center gap-1 min-w-0">
            {i > 0 && <ChevronRight className="h-3 w-3 text-border shrink-0" />}
            <span
              className={cn(
                "inline-flex items-center gap-1 truncate max-w-[8rem]",
                hop.kind === "origin"
                  ? "text-emerald-300/80"
                  : "text-foreground/70",
              )}
              title={hop.kind === "origin" ? "Tracked seed account" : "Previously discovered account"}
            >
              {hop.kind === "origin" && <Anchor className="h-3 w-3 shrink-0" />}
              @{hop.username}
            </span>
          </div>
        ))}
        {depth > 0 && (
          <>
            <ChevronRight className="h-3 w-3 text-border shrink-0" />
            <span className="text-foreground/80 shrink-0">hop {depth}</span>
          </>
        )}
      </div>
    </div>
  );
}

function ClusterPeersBlock({ peers }: { peers: ClusterPeer[] }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <Users className="h-3 w-3 text-muted-foreground" />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Friend group · {peers.length} similar
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {peers.map((p) => (
          <a
            key={p.id}
            href={`https://instagram.com/${p.username}/`}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition-colors",
              p.is_representative
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border bg-background/40 text-foreground/70 hover:text-foreground",
            )}
            title={`Co-appeared ${p.count} time${p.count === 1 ? "" : "s"}${p.is_representative ? " · cluster representative" : ""}`}
          >
            @{p.username}
            <span className="text-muted-foreground tabular-nums">·{p.count}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

