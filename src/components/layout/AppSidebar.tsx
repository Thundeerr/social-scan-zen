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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/layout/BrandMark";

const items = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, hint: "G D" },
  { to: "/accounts", label: "Tracked Accounts", icon: Users, hint: "G T" },
  { to: "/assets", label: "New Assets", icon: Images, hint: "G A" },
  { to: "/downloads", label: "Archive", icon: Download, hint: null as string | null },
  { to: "/scanner", label: "Scanner", icon: Radar, hint: "G S" },
  { to: "/activity", label: "Activity", icon: Activity, hint: null as string | null },
  { to: "/telegram", label: "Telegram", icon: Send, hint: null as string | null },
  { to: "/settings", label: "Settings", icon: Settings, hint: null as string | null },
] as const;

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="flex items-center gap-3 px-4 h-14 border-b border-sidebar-border">
        <BrandMark />
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="text-sm font-semibold tracking-tight text-sidebar-foreground">
            InstaScanner
          </span>
          <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Autonomous Monitoring
          </span>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5">
        <div className="px-2 pb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Workspace
        </div>
        {items.map(({ to, label, icon: Icon, hint }) => {
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
              <span className="flex-1">{label}</span>
              {hint && (
                <kbd className="hidden lg:inline-flex items-center rounded border border-border/60 bg-background/40 px-1 font-mono text-[9px] font-medium text-muted-foreground/80 tracking-wider">
                  {hint}
                </kbd>
              )}
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
