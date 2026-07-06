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
  type ScoreReasons,
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

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Reading discovery graph…
        </div>
      ) : candidates.length === 0 ? (
        <EmptyState state={state} />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {candidates.map((c) => (
            <CandidateCard
              key={c.id}
              candidate={c}
              busy={decide.isPending && decide.variables?.id === c.id}
              onDecide={(decision) => decide.mutate({ id: c.id, decision })}
            />
          ))}
        </div>
      )}
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
  const composite = compositeScore(candidate);
  const scores: Array<{ label: string; value: number | null }> = [
    { label: "Luxury", value: candidate.luxury_score },
    { label: "Quality", value: candidate.quality_score },
    { label: "Aesthetic", value: candidate.aesthetic_score },
    { label: "Travel", value: candidate.travel_score },
    { label: "Auth.", value: candidate.authenticity_score },
  ];

  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        {candidate.avatar_url ? (
          <img
            src={candidate.avatar_url}
            alt=""
            className="h-11 w-11 rounded-full object-cover ring-1 ring-border"
          />
        ) : (
          <div className="h-11 w-11 rounded-full bg-muted flex items-center justify-center text-sm font-medium">
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
              <span className="text-[10px] text-primary" title="Verified">
                ●
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {candidate.full_name ?? candidate.estimated_niche ?? "Analyzing…"}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
            {candidate.estimated_niche && (
              <span className="rounded-sm bg-primary/10 text-primary px-1.5 py-0.5">
                {candidate.estimated_niche}
              </span>
            )}
            {candidate.estimated_post_frequency && (
              <span>{candidate.estimated_post_frequency}</span>
            )}
          </div>
        </div>
        <ScoreRing score={composite} size={44} />
      </div>

      <div className="grid grid-cols-5 gap-1.5">
        {scores.map((s) => (
          <SubScore key={s.label} label={s.label} value={s.value} />
        ))}
      </div>

      {candidate.ai_summary && (
        <p className="text-xs text-muted-foreground line-clamp-3">{candidate.ai_summary}</p>
      )}

      {candidate.signals.length > 0 && (
        <div className="rounded-md border border-border/60 bg-background/40 p-2 space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Why discovered
          </div>
          {candidate.signals.slice(0, 3).map((s, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[11px] text-foreground/80">
              <SignalIcon type={s.source_type} />
              <span className="truncate">{s.seed_label ?? "signal"}</span>
              <span className="text-muted-foreground">· {sourceLabel(s.source_type)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Confidence {Math.round((candidate.confidence ?? 0) * 100)}% · {candidate.signal_count}{" "}
          signal{candidate.signal_count === 1 ? "" : "s"}
        </div>
        <a
          href={`https://instagram.com/${candidate.username}/`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground"
          title="Open on Instagram"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>

      {candidate.state === "new" && (
        <div className="grid grid-cols-3 gap-1.5">
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

function SubScore({ label, value }: { label: string; value: number | null }) {
  const v = value ?? 0;
  return (
    <div className="space-y-1">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="h-1 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full bg-primary/70"
          style={{ width: value == null ? "0%" : `${v}%` }}
        />
      </div>
      <div className="text-[10px] tabular-nums text-foreground/80">
        {value == null ? "—" : v}
      </div>
    </div>
  );
}

function SignalIcon({ type }: { type: string }) {
  if (type === "location_cooccurrence")
    return <MapPin className="h-3 w-3 text-primary" />;
  if (type === "hashtag_cooccurrence") return <Hash className="h-3 w-3 text-primary" />;
  return <Users className="h-3 w-3 text-primary" />;
}

function sourceLabel(t: string): string {
  switch (t) {
    case "account_mention":
      return "mention";
    case "tagged_user":
      return "tagged";
    case "tagged_collaborator":
      return "collab";
    case "co_appearance":
      return "co-appearance";
    case "location_cooccurrence":
      return "same location";
    case "hashtag_cooccurrence":
      return "hashtag";
    case "provider_recommendation":
      return "recommended";
    default:
      return t;
  }
}

function compositeScore(c: DiscoveryCandidateRow): number {
  const parts = [
    c.luxury_score,
    c.quality_score,
    c.aesthetic_score,
    c.travel_score,
    c.authenticity_score,
  ].filter((v): v is number => typeof v === "number");
  if (!parts.length) return Math.round((c.confidence ?? 0) * 100);
  return Math.round(parts.reduce((s, v) => s + v, 0) / parts.length);
}
