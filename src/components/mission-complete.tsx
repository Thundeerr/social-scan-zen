import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Mission-complete panel. Appears when the operator finishes the inbox.
 * No celebration, no gamification — a calm operations readout. Fades out
 * on its own; the background network continues monitoring.
 */
export function MissionComplete({
  approved,
  dismissed,
  onDone,
  visible,
}: {
  approved: number;
  dismissed: number;
  visible: boolean;
  onDone: () => void;
}) {
  const [countdown, setCountdown] = useState(43 * 60 + 12);
  const [phase, setPhase] = useState<"idle" | "in" | "out">("idle");

  useEffect(() => {
    if (!visible) {
      setPhase("idle");
      return;
    }
    setPhase("in");
    const hold = window.setTimeout(() => setPhase("out"), 10000);
    const done = window.setTimeout(() => onDone(), 11700);
    return () => {
      window.clearTimeout(hold);
      window.clearTimeout(done);
    };
  }, [visible, onDone]);

  useEffect(() => {
    if (!visible) return;
    const t = window.setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => window.clearInterval(t);
  }, [visible]);

  if (!visible && phase === "idle") return null;

  const reviewed = approved + dismissed;
  const secondsSaved = reviewed * 35; // ~35s of scrolling per asset
  const timeSaved = formatDuration(secondsSaved);
  const nextScan = formatClock(countdown);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center pointer-events-none"
      aria-live="polite"
    >
      {/* Faint calming veil */}
      <div
        className={cn(
          "absolute inset-0 bg-background/40 backdrop-blur-[2px] transition-opacity duration-1000",
          phase === "in" ? "opacity-100" : "opacity-0",
        )}
      />

      <div
        className={cn(
          "relative w-[min(420px,92vw)] rounded-xl border border-border/70 bg-background/85 px-8 py-7 text-center backdrop-blur-xl shadow-[0_20px_60px_-30px_rgba(0,0,0,0.9)]",
          "transition-all duration-[900ms] ease-out",
          phase === "in"
            ? "opacity-100 translate-y-0 scale-100"
            : "opacity-0 translate-y-2 scale-[0.98]",
        )}
      >
        {/* Header rule */}
        <div className="flex items-center justify-center gap-3">
          <span className="h-px w-8 bg-border/60" />
          <span className="text-[10px] uppercase tracking-[0.32em] text-muted-foreground">
            Mission Status
          </span>
          <span className="h-px w-8 bg-border/60" />
        </div>

        <div className="mt-3 text-[22px] font-semibold tracking-[0.12em] uppercase">
          Review Complete
        </div>

        <div className="mt-1 text-[11px] uppercase tracking-[0.2em] text-muted-foreground tabular-nums">
          {reviewed} {reviewed === 1 ? "Asset" : "Assets"} Reviewed
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4">
          <StatCell label="Approved" value={approved} tone="success" />
          <StatCell label="Dismissed" value={dismissed} tone="muted" />
        </div>

        <div className="mt-6 border-t border-border/40 pt-4">
          <div className="text-[9px] uppercase tracking-[0.28em] text-muted-foreground">
            Estimated Time Saved
          </div>
          <div className="mt-1 text-xl font-medium tabular-nums text-foreground/90">
            {timeSaved}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-center gap-2">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
          </span>
          <span className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground">
            Monitoring continues
          </span>
        </div>

        <div className="mt-2 text-[11px] text-muted-foreground">
          Next scan ·{" "}
          <span className="tabular-nums text-foreground/80">{nextScan}</span>
        </div>

        {/* Footer rule */}
        <div className="mt-6 flex items-center justify-center gap-3">
          <span className="h-px w-8 bg-border/60" />
          <span className="text-[9px] uppercase tracking-[0.32em] text-muted-foreground/70">
            System operational
          </span>
          <span className="h-px w-8 bg-border/60" />
        </div>
      </div>
    </div>
  );
}

function StatCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "success" | "muted";
}) {
  return (
    <div>
      <div
        className={cn(
          "text-2xl font-semibold tabular-nums",
          tone === "success" ? "text-success" : "text-foreground/85",
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

function formatClock(total: number): string {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m`;
}
