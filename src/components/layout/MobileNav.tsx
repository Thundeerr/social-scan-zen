import { useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  MapPin,
  Images,
  Sparkles,
  Download,
  Radar,
  Settings,
  Activity,
  Send,
  Menu,
  Flame,
  Clapperboard,
} from "lucide-react";
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetHeader } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/layout/BrandMark";

const items = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/accounts", label: "Tracked Accounts", icon: Users },
  { to: "/locations", label: "Tracked Locations", icon: MapPin },
  { to: "/assets", label: "New Assets", icon: Images },
  { to: "/discovery", label: "Discovery", icon: Sparkles },
  { to: "/downloads", label: "Archive", icon: Download },
  { to: "/reel-inbox", label: "Reel Inbox", icon: Clapperboard },
  { to: "/content-review", label: "Content Review", icon: Clapperboard },
  { to: "/catalogue", label: "Content Catalogue", icon: Images },
  { to: "/business", label: "Zahlen & Kosten", icon: Images },
  { to: "/generate", label: "Video erstellen", icon: Clapperboard },
  { to: "/scanner", label: "Scanner", icon: Radar },
  { to: "/publisher", label: "Content Publisher", icon: Clapperboard },
  { to: "/burn", label: "Token Burn Rate", icon: Flame },
  { to: "/activity", label: "Activity", icon: Activity },
  { to: "/telegram", label: "Telegram", icon: Send },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label="Open navigation"
          className="md:hidden inline-flex items-center justify-center h-11 w-11 rounded-md border border-border/60 bg-card/60 text-foreground/90 hover:bg-card"
        >
          <Menu className="h-4 w-4" />
        </button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 overflow-y-auto p-0 bg-sidebar border-sidebar-border">
        <SheetHeader className="px-5 h-16 border-b border-sidebar-border flex-row items-center gap-3 space-y-0">
          <BrandMark />
          <div className="flex min-w-0 flex-col leading-tight text-left">
            <SheetTitle className="text-sm font-semibold tracking-tight text-sidebar-foreground">
              InstaScanner
            </SheetTitle>
            <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Autonomous Monitoring
            </span>
          </div>
        </SheetHeader>

        <nav className="flex-1 px-4 py-6 space-y-1">
          <div className="px-2 pb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Workspace
          </div>
          {items.map(({ to, label, icon: Icon }) => {
            const active = to === "/" ? pathname === "/" : pathname.startsWith(to);
            return (
              <Link
                key={to}
                to={to}
                aria-current={active ? "page" : undefined}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex min-h-12 items-center gap-3 rounded-lg px-3 py-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon
                  className={cn("h-4 w-4", active ? "text-primary" : "text-muted-foreground")}
                />
                <span className="flex-1">{label}</span>
              </Link>
            );
          })}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
