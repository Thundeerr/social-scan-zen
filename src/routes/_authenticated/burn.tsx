import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Flame, ShieldCheck, TrendingUp, Users } from "lucide-react";
import { burnForecastFn } from "@/lib/scanner.functions";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/burn")({
  head: () => ({
    meta: [
      { title: "Token Burn Rate · InstaScanner" },
      {
        name: "description",
        content:
          "Live provider request burn rate — current spend, forecast, and time-to-cap for the autonomous fleet.",
      },
    ],
  }),
  component: TokenBurnPage,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="p-6">
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          <div className="font-medium">Burn rate console unavailable</div>
          <div className="mt-1 text-xs text-destructive/80">{error.message}</div>
          <button
            className="mt-3 rounded-md border border-destructive/40 px-3 py-1 text-xs"
            onClick={() => {
              reset();
              router.invalidate();
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  },
  notFoundComponent: () => <div className="p-6 text-sm">Not found</div>,
});

function TokenBurnPage() {
  const forecast = useServerFn(burnForecastFn);
  const q = useQuery({
    queryKey: ["burn-forecast"],
    queryFn: () => forecast(),
    refetchInterval: 30_000,
  });

  const f = q.data;
  const pct = f ? Math.max(0, Math.min(100, f.budget.percentUsed)) : 0;
  const state: "ok" | "warn" | "block" = !f
    ? "ok"
    : f.budget.exhausted
      ? "block"
      : f.budget.warning
        ? "warn"
        : "ok";
  const barTone =
    state === "block" ? "bg-destructive" : state === "warn" ? "bg-warning" : "bg-primary";
  const chipTone =
    state === "block"
      ? "text-destructive border-destructive/40 bg-destructive/10"
      : state === "warn"
        ? "text-warning border-warning/40 bg-warning/10"
        : "text-primary border-primary/30 bg-primary/10";
  const label =
    state === "block"
      ? "Cap reached"
      : state === "warn"
        ? "Approaching cap"
        : "Within budget";

  const daysUntil = f?.daysUntilCap;
  const resetOn = f
    ? new Date(f.budget.periodEnd).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : "—";
  const willOverrun =
    f != null && daysUntil != null && daysUntil * 24 * 60 * 60_000 + Date.now() < new Date(f.budget.periodEnd).getTime()
      ? false
      : f != null && f.projectedPerMonth > f.budget.remaining;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 md:px-6 py-4 md:py-6 space-y-4">
      <PageHeader
        eyebrow="Console"
        title="Token Burn Rate"
        description="Live provider request spend, forecast, and time-to-cap. Every scanner_run counts as one request."
      />

      {/* Current spend */}
      <section className="rounded-xl border border-border bg-card p-4 md:p-5 soft-shadow">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Flame className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Current month
              </div>
              <div className="text-sm font-medium truncate">Provider request budget</div>
            </div>
          </div>
          <span
            className={cn(
              "text-[10px] uppercase tracking-[0.14em] font-mono rounded-full border px-2 py-0.5",
              chipTone,
            )}
          >
            {label}
          </span>
        </div>

        <div className="mt-4">
          <div className="flex items-baseline justify-between font-mono text-xs">
            <span className="text-foreground">
              {(f?.budget.used ?? 0).toLocaleString()}{" "}
              <span className="text-muted-foreground">
                / {(f?.budget.monthlyCap ?? 0).toLocaleString()}
              </span>
            </span>
            <span className="text-muted-foreground">{pct.toFixed(1)}%</span>
          </div>
          <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all", barTone)}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px] text-muted-foreground">
            <Stat label="Remaining" value={(f?.budget.remaining ?? 0).toLocaleString()} />
            <Stat label="Actual · 24h" value={(f?.actualLast24h ?? 0).toLocaleString()} />
            <Stat label="Actual · 7d" value={(f?.actualLast7d ?? 0).toLocaleString()} />
            <Stat label="Resets" value={resetOn} />
          </div>
        </div>
      </section>

      {/* Forecast */}
      <section className="rounded-xl border border-border bg-card p-4 md:p-5 soft-shadow">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Forecast
            </div>
            <div className="text-sm font-medium">
              Projected burn at {f?.scansPerAccountPerDay ?? 4}×/day cadence
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <ForecastCard
            icon={<Users className="h-3.5 w-3.5" />}
            label="Active accounts"
            value={(f?.activeAccounts ?? 0).toLocaleString()}
            sub={`${f?.scansPerAccountPerDay ?? 4} scans/day each`}
          />
          <ForecastCard
            label="Per day"
            value={(f?.projectedPerDay ?? 0).toLocaleString()}
            sub="requests"
          />
          <ForecastCard
            label="Per week"
            value={(f?.projectedPerWeek ?? 0).toLocaleString()}
            sub="requests"
          />
          <ForecastCard
            label="Per month"
            value={(f?.projectedPerMonth ?? 0).toLocaleString()}
            sub={
              f && f.projectedPerMonth > f.budget.monthlyCap
                ? `Exceeds ${f.budget.monthlyCap.toLocaleString()} cap`
                : "requests"
            }
            tone={
              f && f.projectedPerMonth > f.budget.monthlyCap ? "destructive" : "default"
            }
          />
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-md border border-border/60 bg-background/40 px-3 py-2 text-[12px]">
          <ShieldCheck className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
          <div className="flex-1">
            <div className="text-foreground/90">
              Time to cap:{" "}
              <span className="font-mono">
                {daysUntil == null
                  ? "—"
                  : daysUntil > 60
                    ? "> 60 days"
                    : `${daysUntil.toFixed(1)} days`}
              </span>
            </div>
            <div className="text-muted-foreground mt-0.5">
              At the current projected rate, the fleet reaches the monthly cap in
              approximately {daysUntil == null ? "—" : `${daysUntil.toFixed(1)} days`}. Budget
              resets {resetOn}.
            </div>
          </div>
        </div>

        {willOverrun && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-[12px] text-warning">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              Projected monthly burn ({f?.projectedPerMonth.toLocaleString()}) exceeds the
              cap ({f?.budget.monthlyCap.toLocaleString()}). Reduce active accounts or slow
              the scan cadence to stay within budget.
            </span>
          </div>
        )}
      </section>

      <p className="text-[11px] text-muted-foreground px-1">
        Auto-refreshes every 30s. Failed scanner_runs also count against the provider quota
        and are included in the current-month total.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="uppercase tracking-[0.14em] text-[9px] block">{label}</span>
      <span className="font-mono text-foreground/90">{value}</span>
    </div>
  );
}

function ForecastCard({
  icon,
  label,
  value,
  sub,
  tone = "default",
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "destructive";
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3 bg-background/40",
        tone === "destructive" ? "border-destructive/40" : "border-border/60",
      )}
    >
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {icon}
        {label}
      </div>
      <div
        className={cn(
          "mt-1.5 font-mono text-xl",
          tone === "destructive" ? "text-destructive" : "text-foreground",
        )}
      >
        {value}
      </div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
