/**
 * Order path operations panel.
 *
 * One glance answers: is the order path armed, what has it spent, what is
 * stuck, and can I stop it right now. No provider details are exposed.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, PauseCircle, PlayCircle, PlugZap, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/monitor/status-pill";
import {
  getOrderOpsFn,
  runActionTickNowFn,
  setOrdersPausedFn,
  testProviderConnectionFn,
} from "@/lib/monitor.functions";

function Metric({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="rounded-lg border border-border/60 px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className={tone === "warn" ? "text-sm font-medium text-warning" : "text-sm font-medium"}>
        {value}
      </div>
    </div>
  );
}

export function OrderOpsCard() {
  const qc = useQueryClient();
  const getOps = useServerFn(getOrderOpsFn);
  const testConnection = useServerFn(testProviderConnectionFn);
  const runTick = useServerFn(runActionTickNowFn);
  const setPaused = useServerFn(setOrdersPausedFn);

  const opsQuery = useQuery({
    queryKey: ["monitor-order-ops"],
    queryFn: () => getOps(),
    refetchInterval: 60_000,
  });
  const ops = opsQuery.data;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["monitor-order-ops"] });
    qc.invalidateQueries({ queryKey: ["monitor-activity"] });
  };

  const testMutation = useMutation({
    mutationFn: () => testConnection(),
    onSuccess: (r) =>
      r.ok
        ? toast.success(`Provider reachable — balance ${r.balance} ${r.currency ?? ""}`.trim())
        : toast.error(r.error ?? "Provider unreachable"),
    onError: (e: Error) => toast.error(e.message),
  });

  const tickMutation = useMutation({
    mutationFn: () => runTick({ data: undefined as never }),
    onSuccess: (s) => {
      toast.success(
        `Queue worked — ${s.completed} placed, ${s.blocked} blocked, ${s.failed} failed`,
      );
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pauseMutation = useMutation({
    mutationFn: (paused: boolean) => setPaused({ data: { paused } }),
    onSuccess: (r) => {
      toast.success(r.paused ? "Orders paused" : "Orders resumed");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section className="soft-shadow rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-medium">Order path</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Guardrails, spend and queue health for outbound provider orders
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill
            kind={ops?.ordersPaused ? "failed" : ops?.configured ? "completed" : "not_configured"}
            label={ops?.ordersPaused ? "paused" : ops?.configured ? "armed" : "not configured"}
          />
          <Button
            size="sm"
            variant="secondary"
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending}
          >
            {testMutation.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <PlugZap className="mr-1.5 h-3.5 w-3.5" />
            )}
            Test connection
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => tickMutation.mutate()}
            disabled={tickMutation.isPending}
          >
            {tickMutation.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="mr-1.5 h-3.5 w-3.5" />
            )}
            Work queue
          </Button>
          <Button
            size="sm"
            variant={ops?.ordersPaused ? "default" : "destructive"}
            onClick={() => pauseMutation.mutate(!ops?.ordersPaused)}
            disabled={pauseMutation.isPending || !ops}
          >
            {ops?.ordersPaused ? (
              <PlayCircle className="mr-1.5 h-3.5 w-3.5" />
            ) : (
              <PauseCircle className="mr-1.5 h-3.5 w-3.5" />
            )}
            {ops?.ordersPaused ? "Resume" : "Pause orders"}
          </Button>
        </div>
      </div>

      <div className="p-4">
        {opsQuery.isLoading || !ops ? (
          <p className="text-sm text-muted-foreground">Reading order path…</p>
        ) : (
          <>
            {!ops.endpointAllowed && (
              <p className="mb-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {ops.endpointReason} — orders are blocked until the endpoint is corrected.
              </p>
            )}
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Metric
                label="Orders today"
                value={`${ops.ordersToday} / ${ops.dailyCap}`}
                tone={ops.dailyCap > 0 && ops.ordersToday >= ops.dailyCap ? "warn" : undefined}
              />
              <Metric
                label="Orders this month"
                value={`${ops.ordersThisMonth} / ${ops.monthlyCap}`}
                tone={
                  ops.monthlyCap > 0 && ops.ordersThisMonth >= ops.monthlyCap ? "warn" : undefined
                }
              />
              <Metric
                label="Max per order"
                value={ops.maxQuantityPerAction.toLocaleString("en-US")}
              />
              <Metric
                label="Balance floor"
                value={ops.minProviderBalance > 0 ? String(ops.minProviderBalance) : "off"}
              />
              <Metric label="Queued" value={String(ops.queue.queued ?? 0)} />
              <Metric label="In flight" value={String(ops.queue.processing ?? 0)} />
              <Metric
                label="Blocked"
                value={String(ops.queue.blocked ?? 0)}
                tone={(ops.queue.blocked ?? 0) > 0 ? "warn" : undefined}
              />
              <Metric
                label="Unknown outcome"
                value={String(ops.queue.unknown_outcome ?? 0)}
                tone={(ops.queue.unknown_outcome ?? 0) > 0 ? "warn" : undefined}
              />
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
              Endpoint {ops.baseUrl} · orders are dispatched by the queue tick, never inside the
              status scheduler, so a slow provider can never delay monitoring.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
