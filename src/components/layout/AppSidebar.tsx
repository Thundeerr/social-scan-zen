import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronRight, Moon } from "lucide-react";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/layout/BrandMark";
import { getActiveNavigationItem, navigationGroups } from "./navigation";

const STORAGE_KEY = "instascanner.sidebar.groups.v2";

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const activeTo = getActiveNavigationItem(pathname)?.to;
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(navigationGroups.map((group) => [group.id, group.defaultOpen])),
  );

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setOpen((previous) => ({ ...previous, ...JSON.parse(raw) }));
    } catch {
      // Navigation remains usable when browser storage is unavailable.
    }
  }, []);

  useEffect(() => {
    const group = navigationGroups.find((item) => item.items.some((i) => i.to === activeTo));
    if (group)
      setOpen((previous) => (previous[group.id] ? previous : { ...previous, [group.id]: true }));
  }, [activeTo]);

  const toggle = (id: string) => {
    setOpen((previous) => {
      const next = { ...previous, [id]: !previous[id] };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // The expanded state is still retained for this session.
      }
      return next;
    });
  };

  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex xl:w-72">
      <Link
        to="/"
        className="flex h-20 shrink-0 items-center gap-3 border-b border-sidebar-border px-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      >
        <BrandMark className="h-10 w-10 rounded-xl" />
        <div className="min-w-0">
          <span className="block text-base font-semibold tracking-tight text-sidebar-foreground">
            InstaScanner
          </span>
          <span className="block text-xs text-muted-foreground">Your content workspace</span>
        </div>
      </Link>

      <nav aria-label="Main navigation" className="flex-1 space-y-5 overflow-y-auto px-3 py-5">
        {navigationGroups.map((group) => {
          const expanded = open[group.id] ?? group.defaultOpen;
          const hasActive = group.items.some((item) => item.to === activeTo);
          return (
            <div key={group.id}>
              <button
                type="button"
                onClick={() => toggle(group.id)}
                aria-expanded={expanded}
                aria-controls={`sidebar-${group.id}`}
                className="mb-1 flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-xs font-semibold text-muted-foreground transition-colors hover:bg-sidebar-accent/40 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span className="flex-1 text-left">{group.label}</span>
                {!expanded && hasActive && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                <ChevronRight
                  aria-hidden="true"
                  className={cn(
                    "h-4 w-4 transition-transform motion-reduce:transition-none",
                    expanded && "rotate-90",
                  )}
                />
              </button>
              <div id={`sidebar-${group.id}`} hidden={!expanded} className="space-y-1">
                {group.items.map(({ to, label, icon: Icon }) => {
                  const active = to === activeTo;
                  return (
                    <Link
                      key={to}
                      to={to}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex min-h-12 items-center gap-3 rounded-xl px-3 py-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                        active
                          ? "bg-primary/10 font-semibold text-primary ring-1 ring-inset ring-primary/25"
                          : "text-sidebar-foreground/85 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                      )}
                    >
                      <Icon
                        aria-hidden="true"
                        className={cn(
                          "h-[18px] w-[18px] shrink-0",
                          active ? "text-primary" : "text-muted-foreground",
                        )}
                      />
                      <span>{label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="shrink-0 border-t border-sidebar-border px-6 py-5">
        <div className="flex items-center gap-2 text-[11px] font-medium tracking-[0.12em] text-muted-foreground">
          <Moon aria-hidden="true" className="h-3.5 w-3.5 text-primary" />
          MIDNA <span className="text-primary/50">//</span> NIGHT SHIFT
        </div>
      </div>
    </aside>
  );
}
