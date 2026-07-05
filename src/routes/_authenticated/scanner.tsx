import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Layers,
  Zap,
  CheckCircle2,
  Clock,
  Radio,
  AlertTriangle,
  Plug,
  Download,
  Search,
  Database,
  ShieldCheck,
  ShieldAlert,
  Loader2,
} from "lucide-react";
import { KpiCard } from "@/components/kpi-card";
import { PageHeader } from "@/components/page-header";
import {
  useScannerQueue,
  useScannerRuns,
  useScannerStats,
} from "@/lib/db-queries";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { providerBudgetFn, providerHealthFn, scanSingleAccountFn } from "@/lib/scanner.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/scanner")({
  head: () => ({
    meta: [
      { title: "Scanner — InstaScanner" },
      {
        name: "description",
        content:
          "Live operations view of the autonomous scanner — current account, phase, request, and queue in real time.",
      },
    ],
  }),
  component: ScannerPage,
});

// -----------------------------------------------------------------------------
// Time helpers
// -----------------------------------------------------------------------------

function timeUntil(iso: string | null): string {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "any moment";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec.toString().padStart(2, "0")}s`;
  return `${sec}s`;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmtElapsed(ms: number): string {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  if (s < 60) return `${s}.${cs.toString().padStart(2, "0")}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m ${rs.toString().padStart(2, "0")}s`;
}

const AVG_SCAN_SECONDS = 6;

// -----------------------------------------------------------------------------
// Phase definitions — the visible states of a scan
// -----------------------------------------------------------------------------

const PHASES = [
  { id: "connecting", label: "Connecting", icon: Plug },
  { id: "fetching", label: "Fetching", icon: Download },
  { id: "parsing", label: "Parsing", icon: Search },
  { id: "storing", label: "Reconciling", icon: Database },
  { id: "completed", label: "Complete", icon: CheckCircle2 },
] as const;

type PhaseId = (typeof PHASES)[number]["id"];

function phaseIndex(phase: string | null | undefined): number {
  if (!phase) return 0;
  const i = PHASES.findIndex((p) => p.id === phase);
  return i < 0 ? 0 : i;
}

// -----------------------------------------------------------------------------
// Row types
// -----------------------------------------------------------------------------

type QueueRow = {
  id: string;
  status: string;
  attempt: number | null;
  scheduled_for: string | null;
  started_at: string | null;
  completed_at: string | null;
  account_id: string | null;
  phase: string | null;
  phase_detail: string | null;
  assets_found: number | null;
  assets_detected: number;
  assets_duplicates: number | null;
  error: string | null;
  tracked_accounts: {
    username: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
};

// -----------------------------------------------------------------------------
// Live elapsed tick — one interval for the whole page
// -----------------------------------------------------------------------------

function useTick(intervalMs = 200) {
  const [, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((n) => (n + 1) & 0xffff), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
}

// -----------------------------------------------------------------------------
// Live scan card — the "visible process" surface
// -----------------------------------------------------------------------------

function ActiveScanCard({ run }: { run: QueueRow }) {
  const acc = run.tracked_accounts;
  const startedMs = run.started_at ? new Date(run.started_at).getTime() : Date.now();
  const elapsed = Date.now() - startedMs;
  const idx = phaseIndex(run.phase);
  const activePhase = PHASES[Math.min(idx, PHASES.length - 1)];

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border bg-card p-5",
        "border-primary/40 soft-shadow",
      )}
    >
      {/* Scanline — a soft moving beam signalling live work */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent scanline-sweep"
      />

      <div className="flex items-start gap-4">
        {acc?.avatar_url ? (
          <img
            src={acc.avatar_url}
            alt=""
            className="h-12 w-12 rounded-full object-cover ring-2 ring-primary/40"
          />
        ) : (
          <div className="h-12 w-12 rounded-full bg-muted ring-2 ring-primary/40" />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-[0.18em] text-primary">
              Scanning
            </span>
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
          </div>
          <div className="mt-0.5 text-lg font-semibold truncate">
            @{acc?.username ?? "—"}
          </div>
          <div className="text-[11px] text-muted-foreground truncate">
            {acc?.display_name ?? "Live intelligence acquisition"}
            {run.attempt && run.attempt > 1 ? ` · retry ${run.attempt}` : ""}
          </div>
        </div>

        <div className="text-right shrink-0">
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Elapsed
          </div>
          <div className="font-mono text-lg tabular-nums text-foreground">
            {fmtElapsed(elapsed)}
          </div>
        </div>
      </div>

      {/* Phase strip */}
      <div className="mt-5 grid grid-cols-5 gap-1.5">
        {PHASES.map((p, i) => {
          const isActive = i === idx && run.status === "running";
          const isDone = i < idx || run.status === "completed";
          const isFailed = run.status === "failed" && i === idx;
          const Icon = p.icon;
          return (
            <div
              key={p.id}
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[10px] uppercase tracking-wider transition-colors duration-500",
                isFailed
                  ? "border-destructive/50 bg-destructive/10 text-destructive"
                  : isActive
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : isDone
                      ? "border-success/40 bg-success/5 text-success"
                      : "border-border bg-background/40 text-muted-foreground",
              )}
            >
              <Icon
                className={cn("h-3 w-3", isActive && "animate-pulse")}
              />
              <span className="truncate">{p.label}</span>
            </div>
          );
        })}
      </div>

      {/* Current request line */}
      <div className="mt-4 rounded-lg border border-border/70 bg-background/60 p-3">
        <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          <span>{activePhase.label} · signal</span>
          <span className="font-mono">
            {run.assets_found ?? 0} asset{(run.assets_found ?? 0) === 1 ? "" : "s"} found
          </span>
        </div>
        <div className="mt-1 font-mono text-[12px] text-foreground/90 break-all leading-relaxed">
          {run.phase_detail ?? "Awaiting response…"}
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Queue row (queued or running-but-shown-secondary or recently completed)
// -----------------------------------------------------------------------------

function QueueLine({
  row,
  variant,
  position,
}: {
  row: QueueRow;
  variant: "queued" | "running" | "completed" | "failed";
  position?: number;
}) {
  const acc = row.tracked_accounts;
  const idx = phaseIndex(row.phase);
  const progress =
    variant === "completed"
      ? 1
      : variant === "failed"
        ? 1
        : Math.min(idx / (PHASES.length - 1), 0.98);

  return (
    <li
      className={cn(
        "group relative overflow-hidden rounded-lg border px-3 py-2 transition-all duration-500",
        variant === "running"
          ? "border-primary/40 bg-primary/[0.05]"
          : variant === "completed"
            ? "border-success/30 bg-success/[0.04] animate-fade-in"
            : variant === "failed"
              ? "border-destructive/40 bg-destructive/[0.04] animate-fade-in"
              : "border-border bg-background/40",
      )}
    >
      {/* Progress bar layer */}
      <div
        aria-hidden
        className={cn(
          "absolute inset-y-0 left-0 transition-all duration-700 ease-out",
          variant === "completed"
            ? "bg-success/10"
            : variant === "failed"
              ? "bg-destructive/10"
              : variant === "running"
                ? "bg-primary/10"
                : "bg-muted/10",
        )}
        style={{ width: `${progress * 100}%` }}
      />

      <div className="relative flex items-center gap-3">
        {variant === "queued" && position !== undefined ? (
          <span className="w-6 text-center font-mono text-[11px] text-muted-foreground tabular-nums">
            {String(position).padStart(2, "0")}
          </span>
        ) : variant === "running" ? (
          <span className="w-6 flex justify-center">
            <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
          </span>
        ) : variant === "completed" ? (
          <span className="w-6 flex justify-center">
            <CheckCircle2 className="h-4 w-4 text-success" />
          </span>
        ) : (
          <span className="w-6 flex justify-center">
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </span>
        )}

        {acc?.avatar_url ? (
          <img
            src={acc.avatar_url}
            alt=""
            className="h-7 w-7 rounded-full object-cover"
          />
        ) : (
          <div className="h-7 w-7 rounded-full bg-muted" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">
            @{acc?.username ?? "—"}
          </div>
          <div className="text-[11px] text-muted-foreground truncate">
            {variant === "running"
              ? row.phase_detail ?? "Working…"
              : variant === "completed"
                ? `${row.assets_detected} new · ${row.assets_duplicates ?? 0} dupes · ${timeAgo(row.completed_at)}`
                : variant === "failed"
                  ? row.error?.slice(0, 90) ?? "failed"
                  : `Queued · attempt ${row.attempt ?? 1}`}
          </div>
        </div>
        <span
          className={cn(
            "text-[10px] uppercase tracking-wider rounded-full px-2 py-0.5 border",
            variant === "running"
              ? "text-primary bg-primary/10 border-primary/30"
              : variant === "completed"
                ? "text-success bg-success/10 border-success/30"
                : variant === "failed"
                  ? "text-destructive bg-destructive/10 border-destructive/30"
                  : "text-muted-foreground bg-muted/20 border-border",
          )}
        >
          {variant}
        </span>
      </div>
    </li>
  );
}

// -----------------------------------------------------------------------------
// Page
// -----------------------------------------------------------------------------

function ScannerPage() {
  const qc = useQueryClient();
  const { data: queue = [] } = useScannerQueue();
  const { data: runs = [] } = useScannerRuns(20);
  const { data: stats } = useScannerStats();

  // Live ticking clock for elapsed / next-scan countdowns.
  useTick(200);

  // Realtime — queue changes must feel instant, no page reloads.
  useEffect(() => {
    const ch = supabase
      .channel("scanner-page")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scanner_runs" },
        () => {
          qc.invalidateQueries({ queryKey: ["scanner_queue"] });
          qc.invalidateQueries({ queryKey: ["scanner_runs", 20] });
          qc.invalidateQueries({ queryKey: ["scanner_stats"] });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tracked_accounts" },
        () => qc.invalidateQueries({ queryKey: ["scanner_stats"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  const running = useMemo(
    () => (queue as QueueRow[]).filter((r) => r.status === "running"),
    [queue],
  );
  const queued = useMemo(
    () => (queue as QueueRow[]).filter((r) => r.status === "queued"),
    [queue],
  );

  // "Just completed" — recently finished runs that appear in the live rail
  // for a moment so operators can watch rows animate into their finished
  // state before falling into the recent-runs archive.
  const recentlyCompleted = useMemo(() => {
    const cutoff = Date.now() - 20_000;
    return (runs as QueueRow[]).filter(
      (r) =>
        (r.status === "completed" || r.status === "failed") &&
        r.completed_at &&
        new Date(r.completed_at).getTime() >= cutoff,
    );
  }, [runs]);

  // Track which run ids have already been "seen" as running so we can flash
  // them the first time they flip to completed.
  const seenCompleted = useRef<Set<string>>(new Set());
  useEffect(() => {
    recentlyCompleted.forEach((r) => seenCompleted.current.add(r.id));
  }, [recentlyCompleted]);

  const estCompletionSec = (running.length + queued.length) * AVG_SCAN_SECONDS;
  const successCount = runs.filter((r) => r.status === "completed").length;
  const successRate = runs.length
    ? Math.round((successCount / runs.length) * 100)
    : 100;

  return (
    <div className="p-6 md:p-8 space-y-6">
      <PageHeader
        eyebrow="Live operations"
        title="Scanner"
        description="Autonomous network scans every tracked account every 8 hours, plus on-demand."
        status={
          running.length > 0
            ? { label: `${running.length} in flight`, tone: "primary", live: true }
            : { label: "Standby", tone: "success", live: true }
        }
      />


      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        <KpiCard
          label="Queue Size"
          value={queue.length}
          icon={Layers}
          hint={running.length ? `${running.length} in flight` : "standby"}
          accent={running.length > 0}
        />
        <KpiCard
          label="Active Accounts"
          value={stats?.activeAccounts ?? "—"}
          icon={Radio}
          hint="under monitoring"
        />
        <KpiCard
          label="Success Rate"
          value={`${successRate}%`}
          icon={CheckCircle2}
          hint="last 20 runs"
        />
        <KpiCard
          label="Last Successful"
          value={timeAgo(stats?.lastSuccessAt ?? null)}
          icon={Zap}
          hint={stats?.lastSuccessAccount ? `@${stats.lastSuccessAccount}` : "—"}
        />
        <KpiCard
          label="Next Scan"
          value={timeUntil(stats?.nextScanAt ?? null)}
          icon={Clock}
          hint={running.length ? "running" : "auto-scheduled"}
        />
      </div>

      {/* Provider request budget + provider status */}
      <ProviderBudgetPanel />
      <ProviderStatusPanel />

      {/* Live scans — the "visible process" */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Live Operations</h3>
          <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {running.length} active · {queued.length} queued
          </span>
        </div>

        {running.length === 0 && queued.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-pulse" />
              <span className="uppercase tracking-[0.18em] text-[10px]">Network active</span>
            </div>
            <div className="mt-2">
              Scanner is on standby — every tracked account is on schedule.
              Next dispatch in {timeUntil(stats?.nextScanAt ?? null)}.
            </div>
          </div>
        ) : running.length > 0 ? (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {running.map((r) => (
              <ActiveScanCard key={r.id} run={r} />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
            Queue primed · dispatching in seconds.
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Queue */}
        <div className="soft-shadow rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold">Queue</h3>
            <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Est. completion {Math.max(estCompletionSec, 0)}s
            </span>
          </div>
          {queue.length === 0 && recentlyCompleted.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              Network on standby — no accounts due right now.
            </div>
          ) : (
            <ul className="space-y-2">
              {running.map((r) => (
                <QueueLine key={r.id} row={r} variant="running" />
              ))}
              {queued.map((r, i) => (
                <QueueLine key={r.id} row={r} variant="queued" position={i + 1} />
              ))}
              {recentlyCompleted.map((r) => (
                <QueueLine
                  key={r.id}
                  row={r}
                  variant={r.status === "completed" ? "completed" : "failed"}
                />
              ))}
            </ul>
          )}
        </div>

        {/* Recent runs archive */}
        <div className="soft-shadow rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold">Recent Runs</h3>
            <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              last {runs.length}
            </span>
          </div>
          {runs.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              No scanner runs yet.
            </div>
          ) : (
            <ul className="space-y-2">
              {(runs as QueueRow[]).map((r) => {
                const acc = r.tracked_accounts;
                const failed = r.status === "failed";
                return (
                  <li
                    key={r.id}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg border border-border bg-background/40"
                  >
                    {failed ? (
                      <AlertTriangle className="h-4 w-4 text-destructive" />
                    ) : r.status === "completed" ? (
                      <CheckCircle2 className="h-4 w-4 text-success" />
                    ) : (
                      <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">
                        @{acc?.username ?? "—"}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {r.status === "completed"
                          ? `${r.assets_detected} new · ${r.assets_duplicates ?? 0} dupes · ${timeAgo(r.completed_at)}`
                          : failed
                            ? r.error?.slice(0, 80) ?? "failed"
                            : r.phase_detail ?? `attempt ${r.attempt ?? 1}`}
                      </div>
                    </div>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {r.status}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Provider status + on-demand test scan
// -----------------------------------------------------------------------------

function ProviderStatusPanel() {
  const qc = useQueryClient();
  const health = useServerFn(providerHealthFn);
  const scan = useServerFn(scanSingleAccountFn);

  const healthQ = useQuery({
    queryKey: ["provider-health"],
    queryFn: () => health(),
    refetchInterval: 30_000,
  });

  const [username, setUsername] = useState("");

  const mut = useMutation({
    mutationFn: (u: string) => scan({ data: { username: u } }),
    onSuccess: (res) => {
      if (res.ok) {
        toast.success(
          `@${res.username} · ${res.inserted} new · ${res.duplicates} already archived`,
        );
      } else {
        toast.error(`@${res.username} scan failed: ${res.error ?? "unknown"}`);
      }
      // Refresh all scanner surfaces.
      qc.invalidateQueries({ queryKey: ["scanner_runs", 20] });
      qc.invalidateQueries({ queryKey: ["scanner_queue"] });
      qc.invalidateQueries({ queryKey: ["scanner_stats"] });
      qc.invalidateQueries({ queryKey: ["provider-health"] });
      setUsername("");
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Scan failed");
    },
  });

  const h = healthQ.data;
  const state: "loading" | "ok" | "warn" | "down" = !h
    ? "loading"
    : !h.configured
      ? "down"
      : h.lastError && (!h.lastSuccessAt || (h.lastErrorAt ?? "") > h.lastSuccessAt)
        ? "warn"
        : "ok";

  const stateStyles = {
    loading: "border-border text-muted-foreground",
    ok: "border-success/40 text-success",
    warn: "border-yellow-500/40 text-yellow-500",
    down: "border-destructive/40 text-destructive",
  }[state];

  const StateIcon =
    state === "loading" ? Loader2 : state === "ok" ? ShieldCheck : ShieldAlert;

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-start gap-4 flex-wrap">
        <div
          className={cn(
            "flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs uppercase tracking-[0.18em]",
            stateStyles,
          )}
        >
          <StateIcon className={cn("h-3.5 w-3.5", state === "loading" && "animate-spin")} />
          {state === "loading"
            ? "Checking provider…"
            : state === "ok"
              ? "Provider online"
              : state === "warn"
                ? "Provider degraded"
                : "Provider unavailable"}
        </div>
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="text-sm font-medium">Instagram provider</div>
          <div className="text-[11px] text-muted-foreground truncate">
            {h?.host ? `via ${h.host}` : "endpoint hidden — configure RAPIDAPI_HOST"} ·{" "}
            {h?.message ?? "…"}
          </div>
          {h?.lastError && (
            <div className="text-[11px] text-destructive/80 truncate">
              Last error: {h.lastError.slice(0, 140)}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-end gap-3 flex-wrap">
        <div className="flex-1 min-w-[220px]">
          <label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Test scan · single account
          </label>
          <div className="mt-1 flex items-center gap-2 rounded-md border border-border bg-background/60 px-3 py-2">
            <span className="text-muted-foreground text-sm">@</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && username && !mut.isPending) {
                  mut.mutate(username);
                }
              }}
              placeholder="instagram_handle"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              className="bg-transparent outline-none flex-1 text-sm font-mono"
            />
          </div>
        </div>
        <button
          type="button"
          onClick={() => mut.mutate(username)}
          disabled={!username || mut.isPending || state === "down"}
          className={cn(
            "h-10 px-4 rounded-md border text-xs uppercase tracking-[0.18em] transition-colors",
            mut.isPending || state === "down"
              ? "border-border text-muted-foreground cursor-not-allowed"
              : "border-primary/50 text-primary hover:bg-primary/10",
          )}
        >
          {mut.isPending ? (
            <span className="flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Scanning…
            </span>
          ) : (
            "Run scan"
          )}
        </button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Provider budget — RapidAPI has a hard 40k/month request cap. This panel
// gives the operator continuous read-out of month-to-date consumption and
// the scanner refuses to fire once the budget is exhausted.
// -----------------------------------------------------------------------------

function ProviderBudgetPanel() {
  const budget = useServerFn(providerBudgetFn);
  const budgetQ = useQuery({
    queryKey: ["provider-budget"],
    queryFn: () => budget(),
    refetchInterval: 30_000,
  });

  const b = budgetQ.data;
  const pct = b ? Math.max(0, Math.min(100, b.percentUsed)) : 0;
  const state: "ok" | "warn" | "block" = !b
    ? "ok"
    : b.exhausted
      ? "block"
      : b.warning
        ? "warn"
        : "ok";
  const barTone =
    state === "block"
      ? "bg-destructive"
      : state === "warn"
        ? "bg-warning"
        : "bg-primary";
  const chipTone =
    state === "block"
      ? "text-destructive border-destructive/40 bg-destructive/10"
      : state === "warn"
        ? "text-warning border-warning/40 bg-warning/10"
        : "text-primary border-primary/30 bg-primary/10";
  const label =
    state === "block"
      ? "Cap reached"
      : state === "warn"
        ? "Approaching cap"
        : "Within budget";

  const resetOn = b
    ? new Date(b.periodEnd).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : "—";

  return (
    <section className="rounded-xl border border-border bg-card p-4 md:p-5 soft-shadow">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <ShieldCheck className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Provider request budget
            </div>
            <div className="text-sm font-medium truncate">
              RapidAPI · monthly cap
            </div>
          </div>
        </div>
        <span
          className={cn(
            "text-[10px] uppercase tracking-[0.14em] font-mono rounded-full border px-2 py-0.5",
            chipTone,
          )}
        >
          {label}
        </span>
      </div>

      <div className="mt-4">
        <div className="flex items-baseline justify-between font-mono text-xs">
          <span className="text-foreground">
            {(b?.used ?? 0).toLocaleString()}{" "}
            <span className="text-muted-foreground">/ {(b?.monthlyCap ?? 0).toLocaleString()}</span>
          </span>
          <span className="text-muted-foreground">{pct.toFixed(1)}%</span>
        </div>
        <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", barTone)}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
          <div>
            <span className="uppercase tracking-[0.14em] text-[9px] block">Remaining</span>
            <span className="font-mono text-foreground/90">
              {(b?.remaining ?? 0).toLocaleString()}
            </span>
          </div>
          <div>
            <span className="uppercase tracking-[0.14em] text-[9px] block">Warn at</span>
            <span className="font-mono text-foreground/90">{b?.warnAtPercent ?? 85}%</span>
          </div>
          <div>
            <span className="uppercase tracking-[0.14em] text-[9px] block">Resets</span>
            <span className="font-mono text-foreground/90">{resetOn}</span>
          </div>
        </div>
      </div>

      {state !== "ok" && (
        <div
          className={cn(
            "mt-4 flex items-start gap-2 rounded-md border px-3 py-2 text-[12px]",
            state === "block"
              ? "border-destructive/40 bg-destructive/5 text-destructive"
              : "border-warning/40 bg-warning/5 text-warning",
          )}
        >
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            {state === "block"
              ? `Autonomous scans and manual "Scan Now" are paused until ${resetOn} to keep the fleet under the monthly request cap.`
              : `You've spent ${pct.toFixed(0)}% of this month's request budget. The scanner will automatically stop when the cap is reached.`}
          </span>
        </div>
      )}
    </section>
  );
}
