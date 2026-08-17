import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronUp, Shield } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusPill } from "./status-pill";
import { getMonitorSystemStatusFn, getOrderOpsFn } from "@/lib/monitor.functions";

export function SystemStrip({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const systemStatus = useServerFn(getMonitorSystemStatusFn);
  const getOps = useServerFn(getOrderOpsFn);

  const statusQuery = useQuery({
    queryKey: ["monitor-system-status"],
    queryFn: () => systemStatus(),
    staleTime: 60_000,
  });

  const opsQuery = useQuery({
    queryKey: ["monitor-order-ops"],
    queryFn: () => getOps(),
    staleTime: 30_000,
  });

  const status = statusQuery.data;
  const ops = opsQuery.data;

  const allLive =
    status?.statusSourceConfigured &&
    status?.cronSecretConfigured &&
    status?.actionAdapterConfigured &&
    ops?.endpointAllowed &&
    !ops?.ordersPaused;

  const today = ops ? `${ops.ordersToday}/${ops.dailyCap}` : "—";
  const blocked = (ops?.queue.blocked ?? 0) + (ops?.queue.unknown_outcome ?? 0);

  return (
    <div className="soft-shadow flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Shield className="h-3.5 w-3.5 text-muted-foreground" />
          <StatusPill
            kind={allLive ? "completed" : "warning"}
            label={allLive ? "monitoring active" : "check status"}
          />
        </div>
        <span className="hidden h-4 w-px bg-border sm:block" />
        <span className="text-xs text-muted-foreground">
          Status {status?.statusSourceConfigured ? "live" : "off"} · Cron{" "}
          {status?.cronSecretConfigured ? "armed" : "off"} · Orders{" "}
          {ops?.ordersPaused ? "paused" : ops?.configured ? "armed" : "off"}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {ops && (
          <span className="text-xs text-muted-foreground">
            Today {today} · {blocked > 0 ? `${blocked} blocked` : "0 blocked"}
          </span>
        )}
        <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={onToggle}>
          {expanded ? (
            <>
              <ChevronUp className="h-3.5 w-3.5" /> Less
            </>
          ) : (
            <>
              <ChevronDown className="h-3.5 w-3.5" /> Details
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
