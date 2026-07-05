import type { ActivityEvent } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

export function ActivityTimeline({ events }: { events: ActivityEvent[] }) {
  return (
    <ol className="relative space-y-4">
      <div className="absolute left-[7px] top-1.5 bottom-1.5 w-px bg-border" />
      {events.map((e, i) => (
        <li key={i} className="relative pl-6 flex items-start gap-3">
          <span
            className={cn(
              "absolute left-0 top-1.5 h-3.5 w-3.5 rounded-full ring-4 ring-card",
              e.kind === "success" && "bg-success",
              e.kind === "info" && "bg-primary",
              (!e.kind || e.kind === "muted") && "bg-muted-foreground/40",
            )}
          />
          <div className="flex-1 min-w-0">
            <div className="text-[11px] tabular-nums text-muted-foreground">{e.time}</div>
            <div className="text-sm text-foreground/90 leading-snug">{e.label}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}
