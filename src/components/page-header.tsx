import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "success" | "primary" | "warning" | "danger" | "muted";

const TONE_CLASSES: Record<Tone, string> = {
  success: "border-success/40 bg-success/10 text-success",
  primary: "border-primary/40 bg-primary/10 text-primary",
  warning: "border-warning/40 bg-warning/10 text-warning",
  danger: "border-destructive/40 bg-destructive/10 text-destructive",
  muted: "border-border bg-muted/40 text-muted-foreground",
};

/**
 * Canonical operator page header. Mirrors the Dashboard's masthead:
 *   eyebrow (uppercase, tracked, optional pulsing dot)
 *   h1 (text-xl semibold tracking-tight)
 *   subtitle (text-sm muted)
 *   right rail: optional status pill + actions
 */
export function PageHeader({
  eyebrow,
  eyebrowDot = true,
  eyebrowTone = "success",
  title,
  description,
  status,
  actions,
}: {
  eyebrow?: string;
  eyebrowDot?: boolean;
  eyebrowTone?: Tone;
  title: string;
  description?: string;
  status?: { label: string; tone?: Tone; live?: boolean };
  actions?: ReactNode;
}) {
  const dotColor: Record<Tone, string> = {
    success: "bg-success",
    primary: "bg-primary",
    warning: "bg-warning",
    danger: "bg-destructive",
    muted: "bg-muted-foreground/60",
  };

  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && (
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {eyebrowDot && (
              <span
                className={cn(
                  "inline-block h-1.5 w-1.5 rounded-full",
                  dotColor[eyebrowTone],
                  eyebrowTone === "success" || eyebrowTone === "primary"
                    ? "animate-pulse"
                    : undefined,
                )}
              />
            )}
            {eyebrow}
          </div>
        )}
        <h1 className="mt-1 text-xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {(status || actions) && (
        <div className="flex items-center gap-2">
          {status && (
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.15em]",
                TONE_CLASSES[status.tone ?? "success"],
              )}
            >
              <span className="relative flex h-1.5 w-1.5">
                {status.live && (
                  <span
                    className={cn(
                      "absolute inset-0 animate-ping rounded-full opacity-60",
                      dotColor[status.tone ?? "success"],
                    )}
                  />
                )}
                <span
                  className={cn(
                    "relative h-1.5 w-1.5 rounded-full",
                    dotColor[status.tone ?? "success"],
                  )}
                />
              </span>
              {status.label}
            </span>
          )}
          {actions}
        </div>
      )}
    </div>
  );
}
