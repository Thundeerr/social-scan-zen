import { createFileRoute } from "@tanstack/react-router";
import { Layers, Zap, CheckCircle2, Timer, Clock } from "lucide-react";
import { KpiCard } from "@/components/kpi-card";
import { ActivityTimeline } from "@/components/activity-timeline";
import { PageHeader } from "@/components/page-header";
import { scannerHealth } from "@/lib/mock-data";
import { useScanSim } from "@/lib/scan-simulator";

export const Route = createFileRoute("/scanner")({
  head: () => ({ meta: [{ title: "Scanner — InstaScanner" }] }),
  component: ScannerPage,
});

function Sparkline({ points }: { points: number[] }) {
  const max = Math.max(...points);
  const min = Math.min(...points);
  const w = 240;
  const h = 60;
  const d = points
    .map((v, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((v - min) / Math.max(1, max - min)) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-14">
      <defs>
        <linearGradient id="g" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="oklch(0.68 0.16 250)" stopOpacity="0.4" />
          <stop offset="100%" stopColor="oklch(0.68 0.16 250)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L${w},${h} L0,${h} Z`} fill="url(#g)" />
      <path d={d} fill="none" stroke="oklch(0.68 0.16 250)" strokeWidth="1.5" />
    </svg>
  );
}

function ScannerPage() {
  const sim = useScanSim();
  return (
    <div className="p-6 md:p-8 space-y-6">
      <PageHeader
        title="Scanner"
        description="Real-time health and throughput of the monitoring engine."
      />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        <KpiCard label="Queue Size" value={sim.queueSize} icon={Layers} hint={sim.isScanning ? "scanning…" : "idle"} />
        <KpiCard label="Requests (1h)" value={sim.requests.toLocaleString()} icon={Zap} hint="+8% vs. avg" accent />
        <KpiCard label="Success Rate" value={`${sim.successRate}%`} icon={CheckCircle2} hint="last 24h" />
        <KpiCard label="Avg Response" value={`${sim.avgResponse} ms`} icon={Timer} hint="p50 latency" />
        <KpiCard label="Next Scan" value={sim.isScanning ? "running" : scannerHealth.nextScan} icon={Clock} hint="auto-scheduled" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="soft-shadow rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">Requests / minute</h3>
            <span className="text-xs text-muted-foreground">last 30 min</span>
          </div>
          <Sparkline points={[14, 18, 22, 19, 25, 28, 24, 30, 27, 33, 31, 36, 34, 38, 42, 39, 44, 40, 43, 41]} />
        </div>
        <div className="soft-shadow rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">Response time (ms)</h3>
            <span className="text-xs text-muted-foreground">last 30 min</span>
          </div>
          <Sparkline points={[420, 415, 430, 410, 405, 400, 412, 425, 418, 402, 398, 410, 415, 408, 412, 405, 400, 411, 414, 412]} />
        </div>
      </div>

      <div className="soft-shadow rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold">Scan log</h3>
          <span className="text-[10px] uppercase tracking-wider text-success bg-success/10 border border-success/30 rounded-full px-2 py-0.5">
            Running
          </span>
        </div>
        <ActivityTimeline events={scannerActivity} />
      </div>
    </div>
  );
}
