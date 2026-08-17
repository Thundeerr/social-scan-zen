/**
 * Interval editor for a monitored profile.
 *
 * Shows the cost of a decision before it is made: requests per profile per
 * month, projected workspace total, and remaining shared quota. Intervals
 * below the standard floor require a deliberate opt-in and are re-validated
 * server-side.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Gauge, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { getMonitorQuotaFn, setAccountIntervalFn } from "@/lib/monitor.functions";
import {
  HIGH_FREQUENCY_MIN_INTERVAL_MINUTES,
  STANDARD_MIN_INTERVAL_MINUTES,
  estimateMonthlyRequests,
  evaluateQuota,
  formatInterval,
} from "@/lib/monitor/quota";

const PRESETS = [30, 60, 180, 360, 720, 1440];

export function IntervalDialog({
  accountId,
  username,
  intervalMinutes,
  highFrequencyOptIn,
  defaultIntervalMinutes,
  onSaved,
}: {
  accountId: string;
  username: string;
  intervalMinutes: number | null;
  highFrequencyOptIn: boolean;
  defaultIntervalMinutes: number;
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const effective = intervalMinutes ?? defaultIntervalMinutes;
  const [selected, setSelected] = useState(effective);
  const [optIn, setOptIn] = useState(highFrequencyOptIn);

  useEffect(() => {
    if (open) {
      setSelected(effective);
      setOptIn(highFrequencyOptIn);
    }
  }, [open, effective, highFrequencyOptIn]);

  const quotaFn = useServerFn(getMonitorQuotaFn);
  const quotaQuery = useQuery({
    queryKey: ["monitor", "quota"],
    queryFn: () => quotaFn(),
    enabled: open,
  });

  const setInterval = useServerFn(setAccountIntervalFn);
  const save = useMutation({
    mutationFn: () =>
      setInterval({
        data: { accountId, intervalMinutes: selected, highFrequencyOptIn: optIn },
      }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.reason ?? "Interval rejected");
        return;
      }
      toast.success(`@${username} now checks every ${formatInterval(res.intervalMinutes)}`);
      void qc.invalidateQueries({ queryKey: ["monitor"] });
      onSaved?.();
      setOpen(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const perProfile = estimateMonthlyRequests(selected);
  const belowStandard = selected < STANDARD_MIN_INTERVAL_MINUTES;
  const blockedByOptIn = belowStandard && !optIn;

  // Mirror of the server-side projection: swap this account's contribution.
  const projection = useMemo(() => {
    const q = quotaQuery.data;
    if (!q) return null;
    const currentContribution = estimateMonthlyRequests(effective);
    const projected = q.projected - currentContribution + perProfile;
    return evaluateQuota({ projected, used: q.used, cap: q.cap });
  }, [quotaQuery.data, effective, perProfile]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs font-medium">
          {formatInterval(effective)}
          {highFrequencyOptIn && (
            <span className="ml-1 rounded bg-warning/15 px-1 text-[9px] uppercase tracking-wider text-warning">
              hf
            </span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Check interval · @{username}</DialogTitle>
          <DialogDescription>
            Every check costs one provider request. Shorter intervals detect a transition sooner and
            burn the shared monthly quota faster.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {PRESETS.map((p) => {
              const locked = p < STANDARD_MIN_INTERVAL_MINUTES && !optIn;
              return (
                <button
                  key={p}
                  type="button"
                  disabled={locked}
                  onClick={() => setSelected(p)}
                  className={[
                    "rounded-lg border px-2 py-2 text-xs transition-colors",
                    selected === p
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:border-primary/40",
                    locked ? "cursor-not-allowed opacity-40" : "",
                  ].join(" ")}
                >
                  <div className="font-medium">{formatInterval(p)}</div>
                  <div className="text-[10px] tabular-nums">
                    {estimateMonthlyRequests(p).toLocaleString("en-US")}/mo
                  </div>
                </button>
              );
            })}
          </div>

          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-medium">High-frequency mode</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  Unlocks intervals down to {HIGH_FREQUENCY_MIN_INTERVAL_MINUTES} minutes for this
                  profile.
                </div>
              </div>
              <Switch
                checked={optIn}
                onCheckedChange={(v) => {
                  setOptIn(v);
                  if (!v && selected < STANDARD_MIN_INTERVAL_MINUTES) {
                    setSelected(STANDARD_MIN_INTERVAL_MINUTES);
                  }
                }}
              />
            </div>
            {optIn && (
              <div className="mt-2 flex gap-2 rounded-md bg-warning/10 p-2 text-[11px] text-warning">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  At {formatInterval(HIGH_FREQUENCY_MIN_INTERVAL_MINUTES)} a single profile consumes{" "}
                  <strong>
                    {estimateMonthlyRequests(HIGH_FREQUENCY_MIN_INTERVAL_MINUTES).toLocaleString(
                      "en-US",
                    )}
                  </strong>{" "}
                  requests per month — roughly{" "}
                  {Math.round(
                    estimateMonthlyRequests(HIGH_FREQUENCY_MIN_INTERVAL_MINUTES) /
                      Math.max(1, estimateMonthlyRequests(STANDARD_MIN_INTERVAL_MINUTES)),
                  )}
                  × the standard interval.
                </span>
              </div>
            )}
          </div>

          <div className="space-y-1.5 rounded-lg border border-border p-3 text-xs">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              <Gauge className="h-3 w-3" /> Estimated consumption
            </div>
            {quotaQuery.isLoading || !projection ? (
              <p className="text-muted-foreground">Reading shared quota…</p>
            ) : (
              <>
                <Row label="This profile" value={`${perProfile.toLocaleString("en-US")} req/mo`} />
                <Row
                  label="All monitored profiles"
                  value={`${projection.projected.toLocaleString("en-US")} req/mo`}
                />
                <Row
                  label="Already used this month"
                  value={`${projection.used.toLocaleString("en-US")} req`}
                />
                <Row
                  label="Shared cap"
                  value={`${projection.enforcedCap.toLocaleString("en-US")} of ${projection.cap.toLocaleString("en-US")}`}
                />
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={projection.exceeds ? "h-full bg-destructive" : "h-full bg-primary"}
                    style={{ width: `${Math.min(100, projection.percentOfCap)}%` }}
                  />
                </div>
                {projection.exceeds && (
                  <p className="pt-1 text-[11px] text-destructive">
                    Over the enforced limit — the server will reject this interval.
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => save.mutate()}
            disabled={save.isPending || blockedByOptIn || projection?.exceeds === true}
          >
            {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save interval
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
