import {
  TIER_META,
  scoreConfidenceLabel,
  scoreToneClasses,
  type Tier,
} from "@/lib/priority";
import { cn } from "@/lib/utils";

/**
 * Premium confidence indicator for an asset's Operator Score.
 * Renders a compact circular ring with the score numeral inside.
 */
export function ScoreRing({
  score,
  size = 48,
  strokeWidth,
  showLabel = false,
}: {
  score: number;
  size?: number;
  strokeWidth?: number;
  showLabel?: boolean;
}) {
  const sw = strokeWidth ?? Math.max(2, Math.round(size / 12));
  const radius = (size - sw) / 2;
  const c = 2 * Math.PI * radius;
  const dash = (score / 100) * c;
  const tone = scoreToneClasses(score);

  return (
    <div className="inline-flex items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="-rotate-90"
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            className="stroke-border/40"
            strokeWidth={sw}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            className={cn(tone.ring, "transition-[stroke-dasharray] duration-500")}
            strokeWidth={sw}
            strokeDasharray={`${dash} ${c - dash}`}
            strokeLinecap="round"
          />
        </svg>
        <div
          className={cn(
            "absolute inset-0 grid place-items-center font-semibold tabular-nums",
            tone.text,
          )}
          style={{ fontSize: Math.round(size * 0.34) }}
        >
          {score}
        </div>
      </div>
      {showLabel && (
        <div className="flex flex-col leading-tight">
          <span className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
            Operator Score
          </span>
          <span className={cn("text-xs font-medium", tone.text)}>
            {scoreConfidenceLabel(score)}
          </span>
        </div>
      )}
    </div>
  );
}

export function TierChip({
  tier,
  size = "sm",
  showLabel = false,
}: {
  tier: Tier;
  size?: "xs" | "sm" | "md";
  showLabel?: boolean;
}) {
  const meta = TIER_META[tier];
  const dims =
    size === "xs"
      ? "h-4 min-w-4 px-1 text-[9px]"
      : size === "md"
        ? "h-6 min-w-6 px-2 text-xs"
        : "h-5 min-w-5 px-1.5 text-[10px]";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn(
          "inline-flex items-center justify-center rounded-md border font-semibold uppercase tracking-wider tabular-nums",
          dims,
          meta.border,
          meta.bg,
          meta.text,
        )}
        title={`Tier ${tier} · ${meta.label}`}
      >
        {tier}
      </span>
      {showLabel && (
        <span className={cn("text-[10px] uppercase tracking-wider", meta.text)}>
          {meta.label}
        </span>
      )}
    </span>
  );
}
