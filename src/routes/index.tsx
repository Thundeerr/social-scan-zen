import { createFileRoute } from "@tanstack/react-router";
import { Users, Sparkles, Clock, Activity, Plug } from "lucide-react";
import { KpiCard } from "@/components/kpi-card";
import { PostCard } from "@/components/post-card";
import { ActivityTimeline } from "@/components/activity-timeline";
import { kpis } from "@/lib/mock-data";
import { usePosts } from "@/lib/posts-store";
import { useScanSim, formatLastScan } from "@/lib/scan-simulator";
import { useGlobalQuery, matchesQuery } from "@/lib/search-store";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [{ title: "Dashboard — InstaScanner" }],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const allPosts = usePosts();
  const q = useGlobalQuery();
  const sim = useScanSim();
  void sim.nowTick;
  const lastScan = sim.isScanning ? "scanning…" : formatLastScan(sim);
  const searching = q.trim().length > 0;
  const results = searching ? allPosts.filter((p) => matchesQuery(p, q)) : allPosts;
  return (
    <div className="p-6 md:p-8 space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Overview of tracked accounts and freshly detected posts.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        <KpiCard label="Tracked Accounts" value={kpis.trackedAccounts} icon={Users} hint="+4 this week" />
        <KpiCard
          label="New Posts Today"
          value={sim.newPostsToday}
          icon={Sparkles}
          hint={`+${Math.max(0, sim.newPostsToday - kpis.newPostsToday)} this session`}
          accent
        />
        <KpiCard label="Last Scan" value={lastScan} icon={Clock} hint={sim.isScanning ? "in progress" : "auto every 15s"} />
        <KpiCard
          label="Scanner Status"
          value={sim.isScanning ? "Running" : "Idle"}
          icon={Activity}
          hint={sim.isScanning ? `${sim.queueSize} in queue` : "All systems nominal"}
        />
        <KpiCard label="API Provider" value={kpis.apiProvider} icon={Plug} hint={`${sim.successRate}% success`} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-6">
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold">
              {searching ? `Search results for “${q}”` : "Recent Posts"}
            </h2>
            <span className="text-xs text-muted-foreground">
              {searching
                ? `${results.length} match${results.length === 1 ? "" : "es"}`
                : "Showing last 24h"}
            </span>
          </div>
          {results.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card/30 p-12 text-center">
              <p className="text-sm text-muted-foreground">
                No posts match “{q}”.
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-4">
                {results.slice(0, 6).map((p) => (
                  <PostCard key={p.id} post={p} />
                ))}
              </div>
              {searching && results.length > 6 && (
                <div className="mt-4 text-center">
                  <Link
                    to="/posts"
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
              {sim.isScanning ? "Live" : "Idle"}
            </span>
          </div>
          <ActivityTimeline events={sim.events} />
        </aside>
      </div>
    </div>
  );
}
