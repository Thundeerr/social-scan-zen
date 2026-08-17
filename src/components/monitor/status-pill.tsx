import { cn } from "@/lib/utils";

export type PillKind =
  | "private"
  | "public"
  | "unknown"
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "not_configured"
  | "unknown_outcome"
  | "blocked"
  | "running"
  | "completed_with_errors";

const STYLES: Record<PillKind, string> = {
  private: "border-warning/40 bg-warning/10 text-warning",
  public: "border-success/40 bg-success/10 text-success",
  unknown: "border-border bg-muted/40 text-muted-foreground",
  queued: "border-primary/40 bg-primary/10 text-primary",
  processing: "border-primary/40 bg-primary/10 text-primary",
  completed: "border-success/40 bg-success/10 text-success",
  failed: "border-destructive/40 bg-destructive/10 text-destructive",
  not_configured: "border-border bg-muted/40 text-muted-foreground",
  unknown_outcome: "border-warning/40 bg-warning/10 text-warning",
  blocked: "border-destructive/40 bg-destructive/10 text-destructive",
  running: "border-primary/40 bg-primary/10 text-primary",
  completed_with_errors: "border-warning/40 bg-warning/10 text-warning",
};

const LABELS: Record<PillKind, string> = {
  private: "private",
  public: "public",
  unknown: "unknown",
  queued: "queued",
  processing: "processing",
  completed: "completed",
  failed: "failed",
  not_configured: "not configured",
  unknown_outcome: "unknown outcome",
  blocked: "blocked",
  running: "running",
  completed_with_errors: "errors",
};

export function StatusPill({ kind, label }: { kind: string; label?: string }) {
  const key = (kind in STYLES ? kind : "unknown") as PillKind;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] whitespace-nowrap",
        STYLES[key],
      )}
    >
      {label ?? LABELS[key]}
    </span>
  );
}
