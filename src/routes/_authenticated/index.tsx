import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Clock,
  Download,
  Gauge,
  Loader2,
  Plug,
  Radio,
  Sparkles,
  Timer,
  Users,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { ActivityTimeline } from "@/components/activity-timeline";
import { RefreshIndicator } from "@/components/RefreshIndicator";
// Provider is static configuration, not simulation data.
const API_PROVIDER = "Instagram Looter";
import { useAssets } from "@/lib/assets-store";
import { useScanSim, formatLastScan } from "@/lib/scan-simulator";
import { useTrackedAccounts, useActivityLog } from "@/lib/db-queries";
import { runQueueTickFn } from "@/lib/scanner.functions";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Network Status — InstaScanner" },
      {
        name: "description",
        content:
          "Monitoring health, queue, scanner and API status for the autonomous intelligence network.",
      },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const allAssets = useAssets();
  const sim = useScanSim();
  const { data: trackedAccounts = [] } = useTrackedAccounts();
  const { data: activityRows = [] } = useActivityLog(20);
  const runTick = useServerFn(runQueueTickFn);
  const qc = useQueryClient();
  const [scanning, setScanning] = useState(false);
  void sim.nowTick;

  const handleScanNow = async () => {
    if (scanning) return;
    setScanning(true);
    try {
      const outcomes = (await runTick({})) as Array<{
        status: string;
        inserted?: number;
      }>;
      const picked = outcomes?.length ?? 0;
      const inserted = outcomes?.reduce((sum, o) => sum + (o.inserted ?? 0), 0) ?? 0;
      if (picked === 0) {
        toast.info("No sources due — network is caught up.");
      } else {
        toast.success(
          `Scanned ${picked} source${picked === 1 ? "" : "s"} · ${inserted} new asset${inserted === 1 ? "" : "s"}`,
        );
      }
      qc.invalidateQueries();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Scan failed";
      toast.error(message);
    } finally {
      setScanning(false);
    }
  };

  const activityEvents = useMemo(
    () =>
      activityRows.map((r) => {
        const kind: "info" | "success" | "muted" =
          r.event_type === "scan_completed" || r.event_type === "asset_downloaded"
            ? "success"
            : r.event_type === "scan_failed"
            ? "muted"
            : "info";
        const d = new Date(r.created_at as string);
        const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        return { id: r.id as string, time, label: (r.description as string) ?? r.event_type, kind };
      }),
    [activityRows],
  );

  const newAssets = useMemo(
    () => allAssets.filter((a) => a.status === "new"),
    [allAssets],
  );
  const downloaded = useMemo(
    () => allAssets.filter((a) => a.status === "downloaded").length,
    [allAssets],
  );
  const activeSources = trackedAccounts.filter((a) => a.status === "active").length;
  const pausedSources = trackedAccounts.length - activeSources;

  // Composite monitoring health: success rate, queue backlog, active sources.
  const health = useMemo(() => {
    let score = 100;
    if (sim.successRate < 99) score -= (99 - sim.successRate) * 4;
    if (sim.queueSize > 200) score -= 8;
    if (pausedSources > activeSources * 0.15) score -= 6;
    score = Math.max(0, Math.min(100, Math.round(score)));
    const level: "nominal" | "degraded" | "critical" =
      score >= 95 ? "nominal" : score >= 80 ? "degraded" : "critical";
    return { score, level };
  }, [sim.successRate, sim.queueSize, activeSources, pausedSources]);

  const lastScan = sim.isScanning ? "scanning…" : formatLastScan(sim);
  const nextScan = sim.isScanning
    ? "after current cycle"
    : sim.lastScanAt
      ? "in ~12 s"
      : "soon";

  const totalTracked = Math.max(1, trackedAccounts.length);
  const queuePct = Math.min(100, Math.round((sim.queueSize / totalTracked) * 100));

  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
            Network active
          </div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">
            Monitoring network is healthy
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {sim.newAssetsToday} assets detected across {activeSources} active sources today.
            Everything the network surfaced is waiting in the inbox.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleScanNow}
            disabled={scanning}
            className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:border-primary/60 hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-60"
            title="Trigger one scan cycle across all due sources"
          >
            {scanning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Zap className="h-3.5 w-3.5" />
            )}
            <span className="uppercase tracking-[0.15em] text-[10px]">
              {scanning ? "Scanning" : "Scan now"}
            </span>
          </button>
          <RefreshIndicator />
          <HealthBadge level={health.level} score={health.score} />
        </div>
      </div>

      {/* Primary CTA — Review Assets */}
      <Link
        to="/assets"
        search={{ day: "all", status: "all" }}
        className="group relative block overflow-hidden rounded-xl border border-primary/40 bg-primary/5 p-5 md:p-6 soft-shadow hover:border-primary/60 hover:bg-primary/10 transition-colors"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="grid h-11 w-11 place-items-center rounded-lg border border-primary/40 bg-primary/10 text-primary">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-primary/80">
                Awaiting your decision
              </div>
              <div className="mt-0.5 text-lg font-semibold tracking-tight">
                {newAssets.length} asset{newAssets.length === 1 ? "" : "s"} ready for review
              </div>
              <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1.5">
                <span>Approve, download, or ignore.</span>
                <Kbd>J</Kbd><Kbd>K</Kbd><span className="opacity-60">move</span>
                <span className="opacity-30">·</span>
                <Kbd>A</Kbd><span className="opacity-60">approve</span>
                <span className="opacity-30">·</span>
                <Kbd>D</Kbd><span className="opacity-60">download</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm font-medium text-primary group-hover:translate-x-0.5 transition-transform">
            Review Assets
            <ArrowRight className="h-4 w-4" />
          </div>
        </div>
      </Link>

      {/* Health grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
        <StatusTile
          label="Monitoring Health"
          value={`${health.score}%`}
          hint={health.level === "nominal" ? "All systems nominal" : health.level === "degraded" ? "Degraded" : "Critical"}
          icon={Gauge}
          tone={health.level === "nominal" ? "success" : health.level === "degraded" ? "warn" : "danger"}
        />
        <StatusTile
          label="Assets Detected"
          value={sim.newAssetsToday}
          hint={`${newAssets.length} awaiting review`}
          icon={Sparkles}
          tone="primary"
        />
        <StatusTile
          label="Active Sources"
          value={`${activeSources} / ${trackedAccounts.length}`}
          hint={pausedSources > 0 ? `${pausedSources} paused` : "None paused"}
          icon={Users}
        />
        <StatusTile
          label="Queue Health"
          value={sim.queueSize}
          hint={sim.isScanning ? `${queuePct}% remaining` : "Idle"}
          icon={Radio}
          tone={sim.queueSize > 200 ? "warn" : "default"}
          progress={sim.isScanning ? queuePct : undefined}
        />
        <StatusTile
          label="Scanner Status"
          value={sim.isScanning ? "Running" : "Monitoring"}
          hint={lastScan}
          icon={Activity}
          tone={sim.isScanning ? "primary" : "success"}
        />
        <StatusTile
          label="API Health"
          value={`${sim.successRate.toFixed(1)}%`}
          hint={`${sim.avgResponse} ms avg · ${API_PROVIDER}`}
          icon={Plug}
          tone={sim.successRate >= 99 ? "success" : "warn"}
        />
        <StatusTile
          label="Download Status"
          value={downloaded}
          hint={`${allAssets.length} total this session`}
          icon={Download}
        />
        <StatusTile
          label="Next Scan"
          value={nextScan}
          hint="Auto every 60 min"
          icon={Timer}
        />
      </div>

      {/* Network Summary + Scanner Activity */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-6">
        <section className="soft-shadow rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold">Network Summary</h2>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Last 24 h
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <SummaryStat label="Assets delivered" value={sim.newAssetsToday} icon={Sparkles} />
            <SummaryStat label="Requests" value={sim.requests.toLocaleString()} icon={Radio} />
            <SummaryStat label="Success rate" value={`${sim.successRate.toFixed(1)}%`} icon={CheckCircle2} />
            <SummaryStat label="Avg response" value={`${sim.avgResponse} ms`} icon={Clock} />
          </div>
          <div className="mt-5 pt-5 border-t border-border/60 text-xs text-muted-foreground leading-relaxed">
            The network monitored{" "}
            <span className="text-foreground font-medium">{trackedAccounts.length} accounts</span>{" "}
            and surfaced{" "}
            <span className="text-foreground font-medium">{newAssets.length} new assets</span>{" "}
            for review. No sources went dark. Nothing important escaped monitoring.
          </div>
        </section>

        <aside className="soft-shadow rounded-xl border border-border bg-card p-5 h-fit xl:sticky xl:top-20">
          <div className="flex items-center justify-between mb-4 gap-2">
            <h2 className="text-sm font-semibold">Scanner Activity</h2>
            <div className="flex items-center gap-2">
              <RefreshIndicator />
              <span
                className={
                  sim.isScanning
                    ? "text-[10px] uppercase tracking-wider text-primary bg-primary/10 border border-primary/30 rounded-full px-2 py-0.5"
                    : "text-[10px] uppercase tracking-wider text-success bg-success/10 border border-success/30 rounded-full px-2 py-0.5"
                }
              >
                {sim.isScanning ? "Live" : "Standby"}
              </span>
            </div>
          </div>
          <ActivityTimeline events={activityEvents.length ? activityEvents : [{ time: "—", label: "No scanner activity yet", kind: "muted" }]} />
        </aside>
      </div>
    </div>
  );
}

function HealthBadge({ level, score }: { level: "nominal" | "degraded" | "critical"; score: number }) {
  const tone =
    level === "nominal"
      ? "text-success border-success/40 bg-success/10"
      : level === "degraded"
        ? "text-warning border-warning/40 bg-warning/10"
        : "text-destructive border-destructive/40 bg-destructive/10";
  return (
    <div className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${tone}`}>
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
      <span className="uppercase tracking-[0.15em] text-[10px]">{level}</span>
      <span className="opacity-60">·</span>
      <span className="font-medium tabular-nums">{score}%</span>
    </div>
  );
}

type Tone = "default" | "primary" | "success" | "warn" | "danger";

function StatusTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  progress,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: Tone;
  progress?: number;
}) {
  const toneClasses: Record<Tone, string> = {
    default: "text-muted-foreground",
    primary: "text-primary",
    success: "text-success",
    warn: "text-warning",
    danger: "text-destructive",
  };
  const barClasses: Record<Tone, string> = {
    default: "bg-muted-foreground/40",
    primary: "bg-primary",
    success: "bg-success",
    warn: "bg-warning",
    danger: "bg-destructive",
  };
  return (
    <div className="soft-shadow rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
          {label}
        </span>
        <Icon className={`h-3.5 w-3.5 ${toneClasses[tone]}`} />
      </div>
      <div className="mt-2 text-xl font-semibold tracking-tight tabular-nums">{value}</div>
      {hint && (
        <div className={`mt-1 text-xs ${tone === "default" ? "text-muted-foreground" : toneClasses[tone]}`}>
          {hint}
        </div>
      )}
      {typeof progress === "number" && (
        <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-muted/40">
          <div
            className={`h-full ${barClasses[tone]} transition-[width] duration-500`}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}

function SummaryStat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold tracking-tight tabular-nums">{value}</div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-4 min-w-4 items-center justify-center rounded border border-border bg-muted/40 px-1 text-[10px] font-medium text-foreground/80 tabular-nums">
      {children}
    </span>
  );
}
