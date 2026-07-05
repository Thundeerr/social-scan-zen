import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import {
  Layers,
  Zap,
  CheckCircle2,
  Clock,
  Radio,
  AlertTriangle,
} from "lucide-react";
import { KpiCard } from "@/components/kpi-card";
import { PageHeader } from "@/components/page-header";
import {
  useScannerQueue,
  useScannerRuns,
  useScannerStats,
} from "@/lib/db-queries";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/scanner")({
  head: () => ({
    meta: [
      { title: "Scanner — InstaScanner" },
      {
        name: "description",
        content:
          "Autonomous scanner queue, retries and next scheduled scans across the tracked network.",
      },
    ],
  }),
  component: ScannerPage,
});

// -----------------------------------------------------------------------------
// Helpers
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

const AVG_SCAN_SECONDS = 6; // rough estimate; used only for completion display

// -----------------------------------------------------------------------------
// Page
// -----------------------------------------------------------------------------

type QueueRow = {
  id: string;
  status: string;
  attempt: number | null;
  scheduled_for: string | null;
  started_at: string | null;
  account_id: string | null;
  tracked_accounts: {
    username: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
};

type RunRow = QueueRow & {
  completed_at: string | null;
  assets_detected: number;
  error: string | null;
};

function ScannerPage() {
  const qc = useQueryClient();
  const { data: queue = [] } = useScannerQueue();
  const { data: runs = [] } = useScannerRuns(20);
  const { data: stats } = useScannerStats();

  // Subscribe to scanner_runs changes — the queue view feels instant.
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

  const estCompletionSec = (running.length + queued.length) * AVG_SCAN_SECONDS;

  const successCount = runs.filter((r) => r.status === "completed").length;
  const successRate = runs.length
    ? Math.round((successCount / runs.length) * 100)
    : 100;

  return (
    <div className="p-6 md:p-8 space-y-6">
      <PageHeader
        title="Scanner"
        description="Autonomous monitoring — the network scans every tracked account every 60–90 minutes."
      />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        <KpiCard
          label="Queue Size"
          value={queue.length}
          icon={Layers}
          hint={running.length ? `${running.length} running` : "standby"}
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Current queue */}
        <div className="soft-shadow rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold">Current Queue</h3>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Est. completion {Math.max(estCompletionSec, 0)}s
            </span>
          </div>
          {queue.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              Network on standby — no accounts due right now.
            </div>
          ) : (
            <ul className="space-y-2">
              {(queue as QueueRow[]).map((r) => {
                const isRunning = r.status === "running";
                const acc = r.tracked_accounts;
                return (
                  <li
                    key={r.id}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2 rounded-lg border",
                      isRunning
                        ? "border-primary/40 bg-primary/[0.06]"
                        : "border-border bg-background/40",
                    )}
                  >
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full",
                        isRunning
                          ? "bg-primary animate-pulse"
                          : "bg-muted-foreground/50",
                      )}
                    />
                    {acc?.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={acc.avatar_url}
                        alt=""
                        className="h-7 w-7 rounded-full object-cover"
                      />
                    ) : (
                      <div className="h-7 w-7 rounded-full bg-muted" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        @{acc?.username ?? "—"}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {isRunning ? "Scanning now" : "Queued"} · attempt{" "}
                        {r.attempt ?? 1}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "text-[10px] uppercase tracking-wider rounded-full px-2 py-0.5 border",
                        isRunning
                          ? "text-primary bg-primary/10 border-primary/30"
                          : "text-muted-foreground bg-muted/20 border-border",
                      )}
                    >
                      {r.status}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Recent runs */}
        <div className="soft-shadow rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold">Recent Runs</h3>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              last {runs.length}
            </span>
          </div>
          {runs.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              No scanner runs yet.
            </div>
          ) : (
            <ul className="space-y-2">
              {(runs as RunRow[]).map((r) => {
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
                          ? `${r.assets_detected} new · ${timeAgo(r.completed_at)}`
                          : failed
                            ? r.error?.slice(0, 80) ?? "failed"
                            : `attempt ${r.attempt ?? 1}`}
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
