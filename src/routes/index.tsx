import { createFileRoute } from "@tanstack/react-router";
import { Users, Sparkles, Clock, Activity, Plug } from "lucide-react";
import { useMemo } from "react";
import { KpiCard } from "@/components/kpi-card";
import { AssetCard } from "@/components/asset-card";
import { ActivityTimeline } from "@/components/activity-timeline";
import { kpis } from "@/lib/mock-data";
import { useAssets } from "@/lib/assets-store";
import { useScanSim, formatLastScan } from "@/lib/scan-simulator";
import { useGlobalQuery, matchesQuery } from "@/lib/search-store";
import { useRegisterVisibleAssets } from "@/lib/selection-store";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [{ title: "Dashboard — InstaScanner" }],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const allAssets = useAssets();
  const q = useGlobalQuery();
  const sim = useScanSim();
  void sim.nowTick;
  const lastScan = sim.isScanning ? "scanning…" : formatLastScan(sim);
  const searching = q.trim().length > 0;
  const results = useMemo(
    () => (searching ? allAssets.filter((a) => matchesQuery(a, q)) : allAssets),
    [allAssets, q, searching],
  );
  const visible = useMemo(() => results.slice(0, 6), [results]);
  useRegisterVisibleAssets(useMemo(() => visible.map((a) => a.id), [visible]));
  const newAssets = results.filter((a) => a.status === "new");
  return (
    <div className="p-6 md:p-8 space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">While you were away</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {sim.newAssetsToday} new assets detected across {kpis.trackedAccounts} tracked accounts today.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        <KpiCard label="Tracked Accounts" value={kpis.trackedAccounts} icon={Users} hint="+4 this week" />
        <KpiCard
          label="New Assets Today"
          value={sim.newAssetsToday}
          icon={Sparkles}
          hint={`+${Math.max(0, sim.newAssetsToday - kpis.newAssetsToday)} this session`}
          accent
        />
        <KpiCard label="Last Scan" value={lastScan} icon={Clock} hint={sim.isScanning ? "in progress" : "auto every 15s"} />
        <KpiCard
          label="Scanner Status"
          value={sim.isScanning ? "Running" : "Monitoring"}
          icon={Activity}
          hint={sim.isScanning ? `${sim.queueSize} in queue` : "All systems nominal"}
        />
        <KpiCard label="API Provider" value={kpis.apiProvider} icon={Plug} hint={`${sim.successRate}% success`} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-6">
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold">
              {searching ? `Search results for “${q}”` : "Delivered assets"}
            </h2>
            <span className="text-xs text-muted-foreground">
              {searching
                ? `${results.length} match${results.length === 1 ? "" : "es"}`
                : `${newAssets.length} awaiting review`}
            </span>
          </div>
          {results.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card/30 p-12 text-center">
              <p className="text-sm text-muted-foreground">
                {searching ? `No assets match “${q}”.` : "No new assets."}
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-4">
                {visible.map((a) => (
                  <AssetCard key={a.id} asset={a} />
                ))}
              </div>
              {searching && results.length > 6 && (
                <div className="mt-4 text-center">
                  <Link
                    to="/assets"
                    search={{ day: "all", status: "all" }}
                    className="text-xs text-primary hover:underline"
                  >
                    View all {results.length} matches →
                  </Link>
                </div>
              )}
            </>
          )}
        </section>


        <aside className="soft-shadow rounded-xl border border-border bg-card p-5 h-fit xl:sticky xl:top-20">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold">Scanner Activity</h2>
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
          <ActivityTimeline events={sim.events} />
        </aside>
      </div>
    </div>
  );
}
