import { Search, X } from "lucide-react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useScanSim, formatLastScan } from "@/lib/scan-simulator";
import { useGlobalQuery, setGlobalQuery } from "@/lib/search-store";
import { cn } from "@/lib/utils";

export function TopBar() {
  const s = useScanSim();
  void s.nowTick;
  const label = s.isScanning ? "Scanning" : "Idle";
  const rel = s.isScanning ? "in progress" : formatLastScan(s);

  const q = useGlobalQuery();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (r) => r.location.pathname });

  const onChange = (value: string) => {
    setGlobalQuery(value);
    if (value && pathname !== "/posts" && pathname !== "/") {
      navigate({ to: "/posts", search: { day: "all", status: "all" }, replace: true });
    }
  };

  const onFocus = () => {
    // send the user to a view that shows results
    if (pathname !== "/posts" && pathname !== "/") {
      navigate({ to: "/posts", search: { day: "all", status: "all" }, replace: true });
    }
  };

  return (
    <header className="h-14 shrink-0 border-b border-border bg-background/70 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-30">
      <div className="flex h-full items-center gap-4 px-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => onChange(e.target.value)}
            onFocus={onFocus}
            placeholder="Search accounts, posts, captions…"
            className="w-full h-9 rounded-lg bg-muted/60 border border-transparent focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/20 pl-9 pr-16 text-sm placeholder:text-muted-foreground"
          />
          {q ? (
            <button
              onClick={() => setGlobalQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-md border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              ⌘K
            </kbd>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1.5 text-xs">
            <span className="relative flex h-2 w-2">
              {s.isScanning && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60 opacity-75"></span>
              )}
              <span
                className={cn(
                  "relative inline-flex h-2 w-2 rounded-full",
                  s.isScanning ? "bg-primary" : "bg-muted-foreground/60",
                )}
              ></span>
            </span>
            <span className="text-foreground/90">{label}</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground tabular-nums">{rel}</span>
          </div>

          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary to-primary/40 ring-1 ring-primary/40 flex items-center justify-center text-[11px] font-semibold text-primary-foreground">
            OW
          </div>
        </div>
      </div>
    </header>
  );
}
