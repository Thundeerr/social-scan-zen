import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Loader2, Radar, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { CreatorOverview } from "@/components/dashboard/CreatorOverview";
import { ActivityTimeline } from "@/components/activity-timeline";
import { Button } from "@/components/ui/button";
import { useAssets } from "@/lib/assets-store";
import { useScanSim } from "@/lib/scan-simulator";
import { useTrackedAccounts, useActivityLog } from "@/lib/db-queries";
import { runQueueTickFn } from "@/lib/scanner.functions";
import { contentReviewFn } from "@/lib/content-review.functions";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({ meta: [{ title: "Overview — InstaScanner" }] }),
  component: DashboardPage,
});

function DashboardPage() {
  const { user } = Route.useRouteContext();
  const allAssets = useAssets();
  const scanner = useScanSim();
  const accounts = useTrackedAccounts();
  const activity = useActivityLog(8);
  const review = useQuery({
    queryKey: ["content-review", user.id],
    queryFn: () => contentReviewFn({ data: { action: "list" } }),
    refetchInterval: 30000,
  });
  const runTick = useServerFn(runQueueTickFn);
  const cache = useQueryClient();
  const [scanning, setScanning] = useState(false);

  async function handleScanNow() {
    if (scanning) return;
    setScanning(true);
    try {
      const outcomes = (await runTick({})) as Array<{ status: string; inserted?: number }>;
      const picked = outcomes?.length ?? 0;
      const inserted = outcomes?.reduce((sum, result) => sum + (result.inserted ?? 0), 0) ?? 0;
      if (!picked) toast.info("No sources are due for a scan right now.");
      else toast.success(`${picked} sources checked · ${inserted} new finds`);
      await cache.invalidateQueries();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Scan failed.");
    } finally {
      setScanning(false);
    }
  }

  const pending = review.data?.items?.filter((item) => item.status === "pending").length;
  const events = (activity.data ?? []).map((row) => ({
    id: row.id as string,
    time: new Date(row.created_at as string).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    label: (row.description as string) ?? row.event_type,
    kind: (row.event_type === "scan_completed" ? "success" : "info") as "success" | "info",
  }));

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-4 sm:p-6 lg:p-8">
      <CreatorOverview
        pendingCount={pending}
        reviewLoading={review.isPending}
        reviewError={review.isError}
        onRetry={() => void review.refetch()}
      />
      <details className="group rounded-2xl border border-border bg-card/70">
        <summary className="flex min-h-20 cursor-pointer list-none items-center gap-4 rounded-2xl p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
          <Radar className="h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="flex-1">
            <h2 className="font-semibold">Scanner & activity</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Sources, discoveries and recent events
            </p>
          </div>
          <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-5 border-t border-border p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <ScannerStat
              label="Active sources"
              value={
                accounts.isError || accounts.isPending
                  ? "—"
                  : String((accounts.data ?? []).filter((a) => a.status === "active").length)
              }
            />
            <ScannerStat
              label="Last completed scan"
              value={
                scanner.lastScanAt
                  ? new Date(scanner.lastScanAt).toLocaleString("en-GB", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })
                  : "No record yet"
              }
            />
            <ScannerStat
              label="Scanner finds to review"
              value={String(allAssets.filter((asset) => asset.status === "new").length)}
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              className="min-h-12 px-5"
              disabled={scanning}
              onClick={() => void handleScanNow()}
            >
              {scanning ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              {scanning ? "Checking sources …" : "Scan due sources"}
            </Button>
            <Button variant="outline" className="min-h-12 px-5" asChild>
              <Link to="/assets" search={{ day: "all", status: "all" }}>
                View discoveries
              </Link>
            </Button>
            <Button variant="ghost" className="min-h-12 px-5" asChild>
              <Link to="/scanner">Open scanner</Link>
            </Button>
          </div>
          <div className="border-t border-border pt-5">
            <h3 className="mb-4 text-sm font-semibold">Recent activity</h3>
            {activity.isError ? (
              <p role="alert" className="text-sm text-muted-foreground">
                Could not load recent activity.
              </p>
            ) : activity.isPending ? (
              <p role="status" className="text-sm text-muted-foreground">
                Loading recent activity …
              </p>
            ) : (
              <ActivityTimeline
                events={
                  events.length
                    ? events
                    : [{ time: "—", label: "No scanner activity yet", kind: "muted" }]
                }
              />
            )}
          </div>
        </div>
      </details>
    </div>
  );
}

function ScannerStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
