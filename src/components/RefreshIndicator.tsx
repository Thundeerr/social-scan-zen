import { useEffect, useState } from "react";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";

/**
 * Ambient "the network is refreshing" indicator.
 *
 * Reads live fetch state from the shared QueryClient so it reflects every
 * polled query on the page (scanner state, tracked accounts, activity log,
 * assets). Left-click forces a manual refresh of active queries.
 */
export function RefreshIndicator({ className = "" }: { className?: string }) {
  const qc = useQueryClient();
  const fetching = useIsFetching();
  const isFetching = fetching > 0;

  const [lastAt, setLastAt] = useState<number>(() => Date.now());
  const [, forceTick] = useState(0);

  // Mark the moment fetching finishes so we can display "updated Xs ago".
  useEffect(() => {
    if (!isFetching) setLastAt(Date.now());
  }, [isFetching]);

  // Re-render every 5s so the relative label stays fresh.
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  const label = isFetching ? "Refreshing…" : `Updated ${formatAgo(lastAt)}`;

  return (
    <button
      type="button"
      onClick={() => qc.refetchQueries({ type: "active" })}
      title="Refresh now"
      className={
        "group inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/60 px-2.5 py-1 text-[10px] uppercase tracking-[0.15em] text-muted-foreground hover:text-foreground hover:border-border transition-colors " +
        className
      }
    >
      <span className="relative flex h-1.5 w-1.5">
        <span
          className={
            isFetching
              ? "absolute inline-flex h-full w-full rounded-full bg-primary opacity-75 animate-ping"
              : "hidden"
          }
        />
        <span
          className={
            "relative inline-flex h-1.5 w-1.5 rounded-full " +
            (isFetching ? "bg-primary" : "bg-success")
          }
        />
      </span>
      <span className="tabular-nums normal-case tracking-normal text-[11px]">{label}</span>
      <RefreshCw
        className={
          "h-3 w-3 text-muted-foreground/70 group-hover:text-foreground transition-transform " +
          (isFetching ? "animate-spin" : "group-hover:rotate-90")
        }
      />
    </button>
  );
}

function formatAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}
