import { Search } from "lucide-react";

export function TopBar() {
  return (
    <header className="h-14 shrink-0 border-b border-border bg-background/70 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-30">
      <div className="flex h-full items-center gap-4 px-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            placeholder="Search accounts, posts, tags…"
            className="w-full h-9 rounded-lg bg-muted/60 border border-transparent focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/20 pl-9 pr-16 text-sm placeholder:text-muted-foreground"
          />
          <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-md border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            ⌘K
          </kbd>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1.5 text-xs">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60 opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary"></span>
            </span>
            <span className="text-foreground/90">Scanning</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">12 min ago</span>
          </div>

          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary to-primary/40 ring-1 ring-primary/40 flex items-center justify-center text-[11px] font-semibold text-primary-foreground">
            OW
          </div>
        </div>
      </div>
    </header>
  );
}
