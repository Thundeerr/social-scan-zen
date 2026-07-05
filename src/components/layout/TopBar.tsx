import { Search, X, Command as CommandIcon, LogOut } from "lucide-react";
import { MobileNav } from "./MobileNav";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useScanSim, formatLastScan } from "@/lib/scan-simulator";
import { useGlobalQuery, setGlobalQuery } from "@/lib/search-store";
import { setCommandPaletteOpen } from "@/lib/palette-store";
import { useCurrentOperator, operatorInitials } from "@/lib/auth-store";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export function TopBar() {
  const s = useScanSim();
  void s.nowTick;
  const label = s.isScanning ? "Scanning" : "Monitoring";
  const rel = s.isScanning ? "in progress" : formatLastScan(s);

  const q = useGlobalQuery();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (r) => r.location.pathname });

  const onChange = (value: string) => {
    setGlobalQuery(value);
    if (value && pathname !== "/assets" && pathname !== "/") {
      navigate({ to: "/assets", search: { day: "all", status: "all" }, replace: true });
    }
  };

  const onFocus = () => {
    // send the user to a view that shows results
    if (pathname !== "/assets" && pathname !== "/") {
      navigate({ to: "/assets", search: { day: "all", status: "all" }, replace: true });
    }
  };

  return (
    <header className="h-14 shrink-0 border-b border-border bg-background/70 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-30">
      <div className="flex h-full items-center gap-3 px-4 sm:gap-4 sm:px-6">
        <MobileNav />
        <div className="relative flex-1 min-w-0 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            id="global-search"
            value={q}
            onChange={(e) => onChange(e.target.value)}
            onFocus={onFocus}
            placeholder="Search accounts, assets, captions…    /"
            className="w-full h-9 rounded-lg bg-muted/60 border border-transparent focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/20 pl-9 pr-24 text-sm placeholder:text-muted-foreground"
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
            <button
              type="button"
              onClick={() => setCommandPaletteOpen(true)}
              title="Open command palette"
              aria-label="Open command palette"
              className="pointer-events-auto absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 rounded-md border border-border bg-background/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
            >
              <CommandIcon className="h-3 w-3" /> K
            </button>
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
                  s.isScanning ? "bg-primary" : "bg-success/80",
                )}
              ></span>
            </span>
            <span className="text-foreground/90">{label}</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground tabular-nums">{rel}</span>
          </div>

          <OperatorBadge />
        </div>
      </div>
    </header>
  );
}

function OperatorBadge() {
  const { user, profile } = useCurrentOperator();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  if (!user) return null;

  const initials = operatorInitials(profile, user);
  const label = profile?.display_name ?? user.email ?? "Operator";

  const handleSignOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    toast("Session closed");
    navigate({ to: "/login", replace: true });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-full border border-border/60 bg-card/60 pl-1 pr-3 py-1 text-xs text-foreground/90 transition hover:border-border hover:bg-card"
          aria-label="Operator menu"
        >
          <span className="h-6 w-6 rounded-full bg-gradient-to-br from-primary to-primary/40 ring-1 ring-primary/40 flex items-center justify-center text-[10px] font-semibold text-primary-foreground">
            {initials}
          </span>
          <span className="hidden sm:inline max-w-[140px] truncate">{label}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="text-xs text-muted-foreground uppercase tracking-[0.18em]">
            Operator
          </div>
          <div className="mt-1 truncate text-sm text-foreground">{label}</div>
          {profile?.email && profile.email !== label && (
            <div className="truncate text-xs text-muted-foreground">{profile.email}</div>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive">
          <LogOut className="h-3.5 w-3.5 mr-2" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
