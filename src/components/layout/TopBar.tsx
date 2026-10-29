import { Search, X, Command as CommandIcon, LogOut, Radar } from "lucide-react";
import { MobileNav } from "./MobileNav";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useScanSim } from "@/lib/scan-simulator";
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
import { getActiveNavigationItem } from "./navigation";

export function TopBar() {
  const s = useScanSim();
  void s.nowTick;
  const scanLabel = s.isScanning
    ? "Scanning"
    : s.lastScanAt
      ? `Last scan ${new Date(s.lastScanAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
      : "No scans yet";

  const q = useGlobalQuery();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (r) => r.location.pathname });

  const onChange = (value: string) => {
    setGlobalQuery(value);
  };

  const submitSearch = () => {
    // Focus and password-manager autofill must never leave an unrelated form.
    if (q.trim() && pathname !== "/assets") {
      navigate({ to: "/assets", search: { day: "all", status: "all" }, replace: true });
    }
  };

  return (
    <header className="sticky top-0 z-30 h-20 shrink-0 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
      <div className="flex h-full items-center gap-3 px-4 sm:gap-4 sm:px-6 lg:px-8">
        <MobileNav />
        <div className="hidden min-w-0 max-w-60 shrink-0 lg:block">
          <p className="text-xs text-muted-foreground">Your workspace</p>
          <p className="truncate text-sm font-semibold">
            {getActiveNavigationItem(pathname)?.label ?? "InstaScanner"}
          </p>
        </div>
        <div className="relative min-w-0 flex-1 lg:ml-auto lg:max-w-sm">
          <Search
            aria-hidden="true"
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            id="global-search"
            type="search"
            name="asset-search-query"
            autoComplete="off"
            data-lpignore="true"
            data-1p-ignore="true"
            aria-label="Search discovered content — press Enter to open results"
            value={q}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submitSearch();
              }
            }}
            placeholder="Search content …"
            className="h-11 w-full rounded-xl border border-border/80 bg-card pl-9 pr-12 text-sm placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          {q ? (
            <button
              type="button"
              onClick={() => setGlobalQuery("")}
              className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setCommandPaletteOpen(true)}
              title="Quick actions (Ctrl + K)"
              aria-label="Open quick actions"
              className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <CommandIcon className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <div
            className="hidden items-center gap-2 text-xs text-muted-foreground xl:flex"
            title={
              s.lastScanAt
                ? `Last scan: ${new Date(s.lastScanAt).toLocaleString("en-GB")}`
                : "No scans in this session yet"
            }
          >
            <Radar
              aria-hidden="true"
              className={cn(
                "h-4 w-4",
                s.isScanning && "animate-pulse text-primary motion-reduce:animate-none",
              )}
            />
            <span className="tabular-nums">{scanLabel}</span>
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
  const label = profile?.display_name ?? user.email ?? "My account";

  const handleSignOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    toast("You are signed out.");
    navigate({ to: "/login", replace: true });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl border border-border bg-card px-2 text-xs text-foreground transition hover:border-primary/40 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:pr-3"
          aria-label="Open account menu"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/15 text-xs font-semibold text-primary">
            {initials}
          </span>
          <span className="hidden max-w-[100px] truncate sm:inline">{label}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="text-xs text-muted-foreground">My account</div>
          <div className="mt-1 truncate text-sm text-foreground">{label}</div>
          {profile?.email && profile.email !== label && (
            <div className="truncate text-xs text-muted-foreground">{profile.email}</div>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={handleSignOut}
          className="min-h-11 text-destructive focus:text-destructive"
        >
          <LogOut className="h-3.5 w-3.5 mr-2" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
