import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowLeft,
  Gauge,
  Loader2,
  Sparkles,
  TrendingUp,
  TrendingDown,
  Users,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/kpi-card";
import { cn } from "@/lib/utils";
import {
  getDiscoveryAnalyticsFn,
  type DiscoveryAnalyticsData,
} from "@/lib/discovery.functions";

export const Route = createFileRoute("/_authenticated/discovery/analytics")({
  head: () => ({
    meta: [
      { title: "Discovery Analytics — InstaScanner" },
      {
        name: "description",
        content:
          "Instrumentation for the Discovery engine — measure whether it is becoming smarter every day.",
      },
    ],
  }),
  component: DiscoveryAnalyticsPage,
});

function fmtPct(n: number | null | undefined, digits = 0) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}
function fmtNum(n: number | null | undefined, digits = 0) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function DiscoveryAnalyticsPage() {
  const analyticsFn = useServerFn(getDiscoveryAnalyticsFn);
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["discovery_analytics"],
    queryFn: () => analyticsFn(),
    staleTime: 60_000,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Engine intelligence"
        title="Discovery Analytics"
        description="Instrumentation of the Discovery engine itself. Track which signals, seeds, branches, and niches consistently produce accepted candidates — and where the engine is guessing wrong."
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link to="/discovery">
                <ArrowLeft className="h-3.5 w-3.5" />
                Inbox
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              {isFetching ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Activity className="h-3.5 w-3.5" />
              )}
              Recompute
            </Button>
          </div>
        }
      />

      {isLoading && (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto mb-3 h-4 w-4 animate-spin" />
          Computing intelligence report…
        </div>
      )}
      {isError && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive">
          Analytics failed to load. Try again.
        </div>
      )}

      {data && <AnalyticsBody data={data} />}
    </div>
  );
}

function AnalyticsBody({ data }: { data: DiscoveryAnalyticsData }) {
  const o = data.overview;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label="Total candidates"
          value={o.total_candidates}
          hint={`${o.enriched} enriched · ${o.unenriched} pending`}
          icon={Sparkles}
        />
        <KpiCard
          label="Decisions"
          value={o.decisions}
          hint={`${o.pending} awaiting review`}
          icon={Gauge}
          accent
        />
        <KpiCard
          label="Track rate"
          value={fmtPct(o.track_rate)}
          hint={`${o.tracked} tracked · ${o.ignored + o.blacklisted} rejected`}
          icon={TrendingUp}
        />
        <KpiCard
          label="Learning sample"
          value={o.sample_size}
          hint={o.sample_size < 20 ? "Signals still stabilising" : "Signal healthy"}
          icon={Activity}
        />
      </div>

      <SectionCard
        title="Signal type → Track rate"
        subtitle="Which discovery signals (mutual, tagged, hashtag, location, …) actually produce accepted candidates."
      >
        <MetricTable
          empty="No signals recorded yet."
          rows={data.by_source}
          columns={[
            { key: "source_type", label: "Signal", render: (r) => <code className="text-xs">{r.source_type}</code> },
            { key: "candidates", label: "Candidates", render: (r) => r.candidates },
            { key: "tracked", label: "Tracked", render: (r) => r.tracked },
            { key: "rejected", label: "Rejected", render: (r) => r.ignored + r.blacklisted },
            {
              key: "track_rate",
              label: "Track rate",
              render: (r) => <RateBar rate={r.track_rate} tone="positive" />,
            },
          ]}
        />
      </SectionCard>

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard
          title="Root seeds → Hidden gems"
          subtitle="Seeds ranked by track rate × avg AI quality of accepted picks. Rewards seeds that produce fewer but higher-quality candidates."
        >
          <MetricTable
            empty="No seed-attributed candidates yet."
            rows={data.by_seed.slice(0, 15)}
            columns={[
              { key: "label", label: "Seed", render: (r) => <span className="truncate">{r.label}</span> },
              { key: "candidates", label: "Cand.", render: (r) => r.candidates },
              { key: "tracked", label: "Track", render: (r) => r.tracked },
              {
                key: "avg_tracked_quality",
                label: "Avg Q",
                render: (r) => fmtNum(r.avg_tracked_quality, 0),
              },
              {
                key: "hidden_gem_score",
                label: "Gem",
                render: (r) => (
                  <span className="font-mono text-xs text-primary">
                    {fmtNum(r.hidden_gem_score, 1)}
                  </span>
                ),
              },
              {
                key: "track_rate",
                label: "Track %",
                render: (r) => <RateBar rate={r.track_rate} tone="positive" />,
              },
            ]}
          />
        </SectionCard>

        <SectionCard
          title="AI axis ↔ Track correlation"
          subtitle="Point-biserial correlation between each AI score and the operator's Track decision. Higher magnitude = stronger predictor."
        >
          <MetricTable
            empty="Not enough decisions to correlate yet."
            rows={data.score_correlation}
            columns={[
              {
                key: "axis",
                label: "Axis",
                render: (r) => <span className="capitalize">{r.axis}</span>,
              },
              {
                key: "mean_tracked",
                label: "μ tracked",
                render: (r) => fmtNum(r.mean_tracked, 1),
              },
              {
                key: "mean_rejected",
                label: "μ rejected",
                render: (r) => fmtNum(r.mean_rejected, 1),
              },
              {
                key: "gap",
                label: "Gap",
                render: (r) => (
                  <span
                    className={cn(
                      "font-mono text-xs",
                      (r.gap ?? 0) > 0 ? "text-emerald-400" : (r.gap ?? 0) < 0 ? "text-red-400" : "text-muted-foreground",
                    )}
                  >
                    {r.gap === null ? "—" : (r.gap > 0 ? "+" : "") + r.gap.toFixed(1)}
                  </span>
                ),
              },
              {
                key: "point_biserial",
                label: "r_pb",
                render: (r) => (
                  <CorrelationBar value={r.point_biserial} />
                ),
              },
            ]}
          />
        </SectionCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard
          title="Branches with the highest track rate"
          subtitle="Parent candidates whose spawned network gets accepted most often. Worth expanding further."
          icon={TrendingUp}
        >
          <BranchTable rows={data.by_branch.high_yield} tone="positive" />
        </SectionCard>

        <SectionCard
          title="Branches that waste attention"
          subtitle="Parent candidates whose spawned network is repeatedly rejected. Consider pruning or blacklisting the root."
          icon={TrendingDown}
        >
          <BranchTable rows={data.by_branch.low_yield} tone="negative" />
        </SectionCard>
      </div>

      <SectionCard
        title="Niches → Consistent performance"
        subtitle="Which estimated niches consistently outperform. Track rate < 20% with volume ≥ 10 is a candidate for down-weighting."
      >
        <MetricTable
          empty="No niches labelled yet."
          rows={data.by_niche.slice(0, 20)}
          columns={[
            { key: "niche", label: "Niche", render: (r) => <span className="capitalize">{r.niche}</span> },
            { key: "candidates", label: "Volume", render: (r) => r.candidates },
            { key: "tracked", label: "Tracked", render: (r) => r.tracked },
            {
              key: "avg_tracked_quality",
              label: "Avg Q",
              render: (r) => fmtNum(r.avg_tracked_quality, 0),
            },
            {
              key: "track_rate",
              label: "Track rate",
              render: (r) => <RateBar rate={r.track_rate} tone="positive" />,
            },
          ]}
        />
      </SectionCard>

      <SectionCard
        title="Operator divergence"
        subtitle="Cosine similarity between operator niche-weight vectors. Low similarity = diverging tastes."
        icon={Users}
      >
        {!data.divergence.available ? (
          <p className="text-sm text-muted-foreground">
            Cross-operator analytics is scoped to owner / cofounder roles.
          </p>
        ) : data.divergence.pairs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Not enough operators with a stable preference sample yet (needs ≥ 3 decisions each).
          </p>
        ) : (
          <div className="space-y-3">
            {data.divergence.pairs.map((p) => (
              <div
                key={`${p.a_user_id}-${p.b_user_id}`}
                className="rounded-lg border border-border bg-background/40 p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium">
                    <span className="text-foreground">{p.a_label}</span>
                    <span className="mx-2 text-muted-foreground">↔</span>
                    <span className="text-foreground">{p.b_label}</span>
                  </div>
                  <div className="text-xs">
                    <span className="text-muted-foreground">divergence </span>
                    <span
                      className={cn(
                        "font-mono",
                        p.divergence > 0.5
                          ? "text-amber-400"
                          : p.divergence > 0.2
                            ? "text-foreground"
                            : "text-muted-foreground",
                      )}
                    >
                      {p.divergence.toFixed(2)}
                    </span>
                  </div>
                </div>
                {p.top_disagreement.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {p.top_disagreement.map((d) => (
                      <span
                        key={d.niche}
                        className="rounded border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-mono text-muted-foreground"
                      >
                        <span className="capitalize text-foreground">{d.niche}</span>
                        <span className="mx-1">·</span>
                        <span className={d.a_weight >= 0 ? "text-emerald-400" : "text-red-400"}>
                          {d.a_weight.toFixed(1)}
                        </span>
                        <span className="mx-1 text-muted-foreground">/</span>
                        <span className={d.b_weight >= 0 ? "text-emerald-400" : "text-red-400"}>
                          {d.b_weight.toFixed(1)}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </>
  );
}

function SectionCard({
  title,
  subtitle,
  children,
  icon: Icon,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <section className="soft-shadow rounded-xl border border-border bg-card">
      <header className="border-b border-border px-5 py-4">
        <div className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          {Icon && <Icon className="h-3.5 w-3.5 text-primary" />}
          {title}
        </div>
        {subtitle && (
          <p className="mt-1 text-xs text-muted-foreground max-w-2xl">{subtitle}</p>
        )}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

type Column<T> = { key: string; label: string; render: (row: T) => React.ReactNode };

function MetricTable<T>({
  rows,
  columns,
  empty,
}: {
  rows: T[];
  columns: Column<T>[];
  empty: string;
}) {
  if (!rows.length)
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {columns.map((c) => (
              <th key={c.key} className="px-2 py-2 text-left font-medium">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-border/60">
              {columns.map((c) => (
                <td key={c.key} className="px-2 py-2 align-middle">
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RateBar({ rate, tone }: { rate: number; tone: "positive" | "negative" }) {
  const pct = Math.max(0, Math.min(1, rate));
  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="relative h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
        <div
          className={cn(
            "absolute inset-y-0 left-0 rounded-full",
            tone === "positive" ? "bg-emerald-500" : "bg-red-500",
          )}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
      <span className="font-mono text-xs tabular-nums text-muted-foreground w-10 text-right">
        {(pct * 100).toFixed(0)}%
      </span>
    </div>
  );
}

function CorrelationBar({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  const clamped = Math.max(-1, Math.min(1, value));
  const positive = clamped >= 0;
  const width = Math.abs(clamped) * 50;
  return (
    <div className="flex items-center gap-2 min-w-[110px]">
      <div className="relative h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
        <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
        <div
          className={cn(
            "absolute inset-y-0 rounded-full",
            positive ? "bg-emerald-500" : "bg-red-500",
          )}
          style={{
            left: positive ? "50%" : `${50 - width}%`,
            width: `${width}%`,
          }}
        />
      </div>
      <span className="font-mono text-xs tabular-nums w-12 text-right">
        {clamped >= 0 ? "+" : ""}
        {clamped.toFixed(2)}
      </span>
    </div>
  );
}

function BranchTable({
  rows,
  tone,
}: {
  rows: DiscoveryAnalyticsData["by_branch"]["high_yield"];
  tone: "positive" | "negative";
}) {
  if (!rows.length)
    return (
      <p className="text-sm text-muted-foreground">
        Not enough branch decisions yet.
      </p>
    );
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div
          key={r.parent_id}
          className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-background/40 px-3 py-2"
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">@{r.parent_username}</div>
            <div className="text-[11px] text-muted-foreground">
              {r.tracked} tracked · {r.rejected} rejected · {r.children} spawned
              <span className="mx-1">·</span>
              <span className="capitalize">{r.parent_state}</span>
            </div>
          </div>
          <RateBar
            rate={tone === "positive" ? r.track_rate : r.reject_rate}
            tone={tone}
          />
        </div>
      ))}
    </div>
  );
}
