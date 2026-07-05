import { createFileRoute } from "@tanstack/react-router";
import { Users, Sparkles, Clock, Activity, Plug } from "lucide-react";
import { KpiCard } from "@/components/kpi-card";
import { PostCard } from "@/components/post-card";
import { ActivityTimeline } from "@/components/activity-timeline";
import { kpis } from "@/lib/mock-data";
import { usePosts } from "@/lib/posts-store";
import { useScanSim, formatLastScan } from "@/lib/scan-simulator";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [{ title: "Dashboard — InstaScanner" }],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const recentPosts = usePosts();
  const sim = useScanSim();
  void sim.nowTick;
  const lastScan = sim.isScanning ? "scanning…" : formatLastScan(sim);
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
        <KpiCard label="New Posts Today" value={kpis.newPostsToday} icon={Sparkles} hint="+12 vs. yesterday" accent />
        <KpiCard label="Last Scan" value={kpis.lastScan} icon={Clock} hint="14:06 UTC" />
        <KpiCard label="Scanner Status" value={kpis.scannerStatus} icon={Activity} hint="All systems nominal" />
        <KpiCard label="API Provider" value={kpis.apiProvider} icon={Plug} hint="99.2% success" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-6">
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold">Recent Posts</h2>
            <span className="text-xs text-muted-foreground">Showing last 24h</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-4">
            {recentPosts.slice(0, 6).map((p) => (
              <PostCard key={p.id} post={p} />
            ))}
          </div>
        </section>

        <aside className="soft-shadow rounded-xl border border-border bg-card p-5 h-fit xl:sticky xl:top-20">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold">Scanner Activity</h2>
            <span className="text-[10px] uppercase tracking-wider text-success bg-success/10 border border-success/30 rounded-full px-2 py-0.5">
              Live
            </span>
          </div>
          <ActivityTimeline events={scannerActivity} />
        </aside>
      </div>
    </div>
  );
}
