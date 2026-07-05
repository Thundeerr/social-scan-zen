import { cn } from "@/lib/utils";

type Kind = "info" | "success" | "muted";

export type TimelineEvent = {
  id?: string | number;
  time: string;
  label: string;
  kind?: Kind;
};

export function ActivityTimeline({ events }: { events: TimelineEvent[] }) {
  return (
    <ol className="relative space-y-4">
      <div className="absolute left-[7px] top-1.5 bottom-1.5 w-px bg-border" />
      {events.map((e, i) => (
        <li
          key={e.id ?? i}
          className="relative pl-6 flex items-start gap-3 animate-fade-in"
        >
          <span
            className={cn(
              "absolute left-0 top-1.5 h-3.5 w-3.5 rounded-full ring-4 ring-card",
              e.kind === "success" && "bg-success",
              e.kind === "info" && "bg-primary",
              (!e.kind || e.kind === "muted") && "bg-muted-foreground/40",
              i === 0 && e.kind !== "muted" && "animate-[pulse_2s_ease-in-out_infinite]",
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
