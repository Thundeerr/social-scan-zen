import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  Images,
  Download,
  Radar,
  Settings,
  ScanLine,
} from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/accounts", label: "Tracked Accounts", icon: Users },
  { to: "/assets", label: "New Assets", icon: Images },
  { to: "/downloads", label: "Archive", icon: Download },
  { to: "/scanner", label: "Scanner", icon: Radar },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="flex items-center gap-2.5 px-5 h-14 border-b border-sidebar-border">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 ring-1 ring-primary/30">
          <ScanLine className="h-4 w-4 text-primary" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold tracking-tight text-sidebar-foreground">
            InstaScanner
          </span>
          <span className="text-[10px] text-muted-foreground">Autonomous Monitoring</span>
        </div>
      </div>

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
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon className={cn("h-4 w-4", active ? "text-primary" : "text-muted-foreground")} />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-3 border-t border-sidebar-border">
        <div className="flex items-center gap-2.5 rounded-md px-2 py-2">
          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary to-primary/40 ring-1 ring-primary/40 flex items-center justify-center text-[11px] font-semibold text-primary-foreground">
            OW
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-xs font-medium text-sidebar-foreground">Operator</span>
            <span className="text-[10px] text-muted-foreground">Internal · 2 seats</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
