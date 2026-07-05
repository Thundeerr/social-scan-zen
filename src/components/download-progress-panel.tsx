import { useMemo } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Download,
  Loader2,
  RotateCcw,
  X,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useDownloadProgress,
  setPanelOpen,
  dismissItem,
  clearFinished,
  type DownloadProgressItem,
} from "@/lib/download-progress-store";
import { retryDownload } from "@/lib/downloads-store";
import { toast } from "sonner";

function fmtBytes(n: number): string {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function DownloadProgressPanel() {
  const { items, order, batches, panelOpen } = useDownloadProgress();

  const list = useMemo(
    () =>
      order
        .map((id) => items.get(id))
        .filter((x): x is DownloadProgressItem => !!x),
    [order, items],
  );

  const activeCount = list.filter(
    (i) => i.phase === "fetching" || i.phase === "writing" || i.phase === "queued",
  ).length;
  const failedCount = list.filter((i) => i.phase === "error").length;
  const successCount = list.filter((i) => i.phase === "success").length;

  const activeBatch = useMemo(() => {
    for (const b of batches.values()) {
      if (b.endedAt == null) return b;
    }
    return null;
  }, [batches]);

  if (list.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[360px] max-w-[calc(100vw-2rem)]">
      <div className="soft-shadow overflow-hidden rounded-2xl border border-border bg-card/95 backdrop-blur">
        {/* Header */}
        <button
          type="button"
          onClick={() => setPanelOpen(!panelOpen)}
          className="flex w-full items-center gap-2 border-b border-border/60 px-3 py-2 text-left"
        >
          <div className="grid h-7 w-7 place-items-center rounded-md bg-primary/15 ring-1 ring-primary/30">
            {activeCount > 0 ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            ) : failedCount > 0 ? (
              <XCircle className="h-3.5 w-3.5 text-destructive" />
            ) : (
              <Download className="h-3.5 w-3.5 text-primary" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold tracking-tight text-foreground">
              {activeCount > 0
                ? activeBatch
                  ? `Synchronizing ${activeBatch.done + activeBatch.failed + 1}/${activeBatch.total}`
                  : `Downloading ${activeCount}`
                : failedCount > 0
                  ? `${failedCount} failed · ${successCount} synchronized`
                  : `${successCount} synchronized`}
            </div>
            <div className="text-[10px] text-muted-foreground tabular-nums">
              {activeBatch
                ? `${activeBatch.done} ok · ${activeBatch.failed} failed`
                : list.length === 1
                  ? "1 asset"
                  : `${list.length} assets`}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {(successCount > 0 || failedCount > 0) && activeCount === 0 && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  clearFinished();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.stopPropagation();
                    clearFinished();
                  }
                }}
                className="rounded-md px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Clear
              </span>
            )}
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 text-muted-foreground transition-transform",
                panelOpen ? "rotate-0" : "-rotate-90",
              )}
            />
          </div>
        </button>

        {/* Body */}
        {panelOpen && (
          <ul className="max-h-[50vh] divide-y divide-border/50 overflow-y-auto">
            {list
              .slice()
              .reverse()
              .map((item) => (
                <ProgressRow key={item.id} item={item} />
              ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ProgressRow({ item }: { item: DownloadProgressItem }) {
  const pct =
    item.phase === "success"
      ? 100
      : item.total > 0
        ? Math.min(100, Math.round((item.received / item.total) * 100))
        : item.phase === "writing"
          ? 95
          : item.received > 0
            ? 50
            : 8;

  const label =
    item.phase === "success"
      ? "Synchronized"
      : item.phase === "error"
        ? "Failed"
        : item.phase === "writing"
          ? "Writing"
          : item.phase === "queued"
            ? "Queued"
            : "Fetching";

  const onRetry = async () => {
    toast.info(`Retrying @${item.target.username}`);
    const ok = await retryDownload(item.target);
    if (ok) toast.success(`Synchronized @${item.target.username}`);
    else toast.error(`Retry failed for @${item.target.username}`);
  };

  return (
    <li className="px-3 py-2.5">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center">
          {item.phase === "success" ? (
            <CheckCircle2 className="h-4 w-4 text-success" />
          ) : item.phase === "error" ? (
            <XCircle className="h-4 w-4 text-destructive" />
          ) : (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1 truncate text-xs font-medium">
              {item.filename ?? `@${item.target.username}`}
            </div>
            <div className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
              {label}
            </div>
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground tabular-nums">
            @{item.target.username}
            {item.phase === "fetching" || item.phase === "writing" ? (
              <>
                {" · "}
                {fmtBytes(item.received)}
                {item.total > 0 ? ` / ${fmtBytes(item.total)}` : ""}
              </>
            ) : item.phase === "success" && item.received > 0 ? (
              <>{" · "}{fmtBytes(item.received)}</>
            ) : item.phase === "error" && item.error ? (
              <>{" · "}<span className="text-destructive/90">{item.error}</span></>
            ) : null}
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full transition-[width] duration-300",
                item.phase === "success"
                  ? "bg-success"
                  : item.phase === "error"
                    ? "bg-destructive/70"
                    : "bg-primary",
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {item.phase === "error" && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background/60 px-1.5 py-0.5 text-[10px] font-medium text-foreground/90 hover:border-primary/40 hover:text-foreground"
              title="Retry download"
            >
              <RotateCcw className="h-3 w-3" /> Retry
            </button>
          )}
          {(item.phase === "success" || item.phase === "error") && (
            <button
              type="button"
              onClick={() => dismissItem(item.id)}
              aria-label="Dismiss"
              className="rounded-md p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
