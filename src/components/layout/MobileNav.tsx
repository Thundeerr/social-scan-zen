import { useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  Images,
  Download,
  Radar,
  Settings,
  Activity,
  Send,
  Menu,
  Flame,
} from "lucide-react";
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetHeader } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/layout/BrandMark";

const items = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/accounts", label: "Tracked Accounts", icon: Users },
  { to: "/assets", label: "New Assets", icon: Images },
  { to: "/downloads", label: "Archive", icon: Download },
  { to: "/scanner", label: "Scanner", icon: Radar },
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
          className="md:hidden inline-flex items-center justify-center h-9 w-9 rounded-md border border-border/60 bg-card/60 text-foreground/90 hover:bg-card"
        >
          <Menu className="h-4 w-4" />
        </button>
      </SheetTrigger>
      <SheetContent side="left" className="w-64 p-0 bg-sidebar border-sidebar-border">
        <SheetHeader className="px-4 h-14 border-b border-sidebar-border flex-row items-center gap-3 space-y-0">
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

        <nav className="flex-1 px-3 py-4 space-y-0.5">
          <div className="px-2 pb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Workspace
          </div>
          {items.map(({ to, label, icon: Icon }) => {
            const active = to === "/" ? pathname === "/" : pathname.startsWith(to);
            return (
              <Link
                key={to}
                to={to}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className={cn("h-4 w-4", active ? "text-primary" : "text-muted-foreground")} />
                <span className="flex-1">{label}</span>
              </Link>
            );
          })}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
