import { useEffect, useState } from "react";
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
  Flame,
  Gauge,
  Eye,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/layout/BrandMark";

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  hint: string | null;
};

type NavGroup = {
  id: string;
  label: string;
  defaultOpen: boolean;
  items: NavItem[];
};

const groups: NavGroup[] = [
  {
    id: "core",
    label: "InstaScanner",
    defaultOpen: true,
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard, hint: "G D" },
      { to: "/accounts", label: "Tracked Accounts", icon: Users, hint: "G T" },
      { to: "/locations", label: "Tracked Locations", icon: MapPin, hint: "G L" },
      { to: "/assets", label: "New Assets", icon: Images, hint: "G A" },
      { to: "/scanner", label: "Scanner", icon: Radar, hint: "G S" },
      { to: "/downloads", label: "Archive", icon: Download, hint: null },
    ],
  },
  {
    id: "discovery",
    label: "Discovery",
    defaultOpen: false,
    items: [
      { to: "/discovery", label: "Discovery", icon: Sparkles, hint: "G X" },
      { to: "/discovery/analytics", label: "Analytics", icon: Gauge, hint: null },
    ],
  },
  {
    id: "ops",
    label: "Operations",
    defaultOpen: false,
    items: [
      { to: "/monitor", label: "Transition Watch", icon: Eye, hint: null },
      { to: "/burn", label: "Token Burn Rate", icon: Flame, hint: null },
      { to: "/activity", label: "Activity", icon: Activity, hint: null },
      { to: "/telegram", label: "Telegram", icon: Send, hint: null },
      { to: "/settings", label: "Settings", icon: Settings, hint: null },
    ],
  },
];

const allItems = groups.flatMap((g) => g.items);
const STORAGE_KEY = "instascanner.sidebar.groups";

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Longest-prefix wins so /discovery/analytics doesn't also light up /discovery.
  const activeTo = allItems.reduce<string | null>((best, { to }) => {
    const match = to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(to + "/");
    if (!match) return best;
    if (!best || to.length > best.length) return to;
    return best;
  }, null);

  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(groups.map((g) => [g.id, g.defaultOpen])),
  );

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setOpen((prev) => ({ ...prev, ...JSON.parse(raw) }));
    } catch {
      /* ignore */
    }
  }, []);

  // Keep the group containing the current route open.
  useEffect(() => {
    const group = groups.find((g) => g.items.some((i) => i.to === activeTo));
    if (group) setOpen((prev) => (prev[group.id] ? prev : { ...prev, [group.id]: true }));
  }, [activeTo]);

  const toggle = (id: string) => {
    setOpen((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

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

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-3">
        {groups.map((group) => {
          const expanded = open[group.id] ?? group.defaultOpen;
          const hasActive = group.items.some((i) => i.to === activeTo);
          return (
            <div key={group.id} className="space-y-0.5">
              <button
                type="button"
                onClick={() => toggle(group.id)}
                aria-expanded={expanded}
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:text-sidebar-foreground"
              >
                <ChevronRight
                  className={cn(
                    "h-3 w-3 transition-transform duration-200",
                    expanded && "rotate-90",
                  )}
                />
                <span className="flex-1 text-left">{group.label}</span>
                {!expanded && hasActive && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
              </button>

              {expanded &&
                group.items.map(({ to, label, icon: Icon, hint }) => {
                  const active = to === activeTo;
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
                      <Icon
                        className={cn("h-4 w-4", active ? "text-primary" : "text-muted-foreground")}
                      />
                      <span className="flex-1">{label}</span>
                      {hint && (
                        <kbd className="hidden lg:inline-flex items-center rounded border border-border/60 bg-background/40 px-1 font-mono text-[9px] font-medium text-muted-foreground/80 tracking-wider">
                          {hint}
                        </kbd>
                      )}
                    </Link>
                  );
                })}
            </div>
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
