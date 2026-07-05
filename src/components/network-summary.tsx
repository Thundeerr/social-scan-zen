import { useEffect, useState } from "react";
import { Radar, ChevronRight, ListChecks, Layers } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * NETWORK SUMMARY
 * -----------------------------------------------------------------------
 * Calm briefing surface. Appears when AI has determined that no critical
 * assets require immediate operator attention. The panel NEVER hides or
 * removes assets — it only reframes the workload and offers two equally
 * clear paths forward. AI recommends. The operator decides.
 */
export function NetworkSummary({
  visible,
  processed,
  highPriority,
  worthReviewing,
  lowPriority,
  onReviewRecommended,
  onReviewEverything,
}: {
  visible: boolean;
  processed: number;
  highPriority: number;
  worthReviewing: number;
  lowPriority: number;
  onReviewRecommended: () => void;
  onReviewEverything: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => setMounted(true), 20);
    return () => clearTimeout(t);
  }, [visible]);
  useEffect(() => {
    if (!visible) setMounted(false);
  }, [visible]);

  if (!visible) return null;

  // Estimated review time: ~45s per worth-reviewing, ~5s per low-priority glance.
  const seconds = worthReviewing * 45 + lowPriority * 5;
  const mins = Math.max(1, Math.round(seconds / 60));
  const timeLabel = mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h ${mins % 60}m`;

  return (
    <div
      className={cn(
        "border-b border-border/60 bg-background/70 backdrop-blur-sm",
        "transition-all duration-700 ease-out",
        mounted ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1",
      )}
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-6 py-5 md:flex-row md:items-center md:justify-between">
        {/* Left — briefing */}
        <div className="flex min-w-0 items-start gap-4">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/60 bg-card/40">
            <Radar className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400/70 shadow-[0_0_10px_rgba(52,211,153,0.6)]" />
              Network Summary
            </div>
            <div className="mt-2 text-sm text-foreground">
              No critical assets detected.
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground/80">
              AI recommends a light review — nothing has been hidden.
            </div>
          </div>
        </div>

        {/* Middle — stats */}
        <div className="grid grid-cols-4 gap-4 md:gap-6">
          <Stat value={processed} label="Processed" />
          <Stat value={highPriority} label="High Priority" tone={highPriority > 0 ? "warn" : "muted"} />
          <Stat value={worthReviewing} label="Worth Reviewing" />
          <Stat value={lowPriority} label="Low Priority" tone="muted" />
        </div>

        {/* Right — actions */}
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <div className="hidden text-right text-[10px] uppercase tracking-[0.2em] text-muted-foreground md:block">
            <div>Est. Review</div>
            <div className="mt-0.5 font-mono text-xs tracking-normal text-foreground/80">
              {timeLabel}
            </div>
          </div>
          <button
            onClick={onReviewRecommended}
            className="group inline-flex items-center justify-center gap-2 rounded-md border border-border/70 bg-card/60 px-4 py-2 text-xs font-medium text-foreground transition hover:border-foreground/40 hover:bg-card"
          >
            <ListChecks className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground" />
            Review Recommended
            <ChevronRight className="h-3.5 w-3.5 opacity-60 transition group-hover:translate-x-0.5" />
          </button>
          <button
            onClick={onReviewEverything}
            className="group inline-flex items-center justify-center gap-2 rounded-md border border-border/60 bg-transparent px-4 py-2 text-xs font-medium text-muted-foreground transition hover:border-border hover:text-foreground"
          >
            <Layers className="h-3.5 w-3.5" />
            Review Everything
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({
  value,
  label,
  tone = "default",
}: {
  value: number;
  label: string;
  tone?: "default" | "muted" | "warn";
}) {
  return (
    <div className="min-w-[64px]">
      <div
        className={cn(
          "font-mono text-lg leading-none tabular-nums",
          tone === "muted" && "text-muted-foreground",
          tone === "warn" && "text-amber-300",
          tone === "default" && "text-foreground",
        )}
      >
        {value}
      </div>
      <div className="mt-1.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
    </div>
  );
}
