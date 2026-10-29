import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronRight, Menu } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
  SheetHeader,
  SheetDescription,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/layout/BrandMark";
import { getActiveNavigationItem, navigationGroups } from "./navigation";

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(navigationGroups.map((group) => [group.id, group.defaultOpen])),
  );
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const activeTo = getActiveNavigationItem(pathname)?.to;

  useEffect(() => {
    const group = navigationGroups.find((item) => item.items.some((i) => i.to === activeTo));
    if (group) setExpanded((previous) => ({ ...previous, [group.id]: true }));
  }, [activeTo]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label="Open menu"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-[min(320px,90vw)] overflow-y-auto border-sidebar-border bg-sidebar p-0"
      >
        <SheetHeader className="h-20 flex-row items-center gap-3 space-y-0 border-b border-sidebar-border px-5 pr-10">
          <BrandMark className="h-10 w-10 rounded-xl" />
          <div className="min-w-0 text-left">
            <SheetTitle className="text-base font-semibold tracking-tight text-sidebar-foreground">
              InstaScanner
            </SheetTitle>
            <SheetDescription className="text-xs text-muted-foreground">
              Your content workspace
            </SheetDescription>
          </div>
        </SheetHeader>

        <nav aria-label="Mobile navigation" className="space-y-4 px-3 py-4">
          {navigationGroups.map((group) => (
            <div key={group.id}>
              <button
                type="button"
                aria-expanded={expanded[group.id]}
                aria-controls={`mobile-${group.id}`}
                onClick={() =>
                  setExpanded((previous) => ({ ...previous, [group.id]: !previous[group.id] }))
                }
                className="mb-1 flex min-h-11 w-full items-center justify-between rounded-xl px-3 text-xs font-semibold text-muted-foreground hover:bg-sidebar-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {group.label}
                <ChevronRight
                  aria-hidden="true"
                  className={cn(
                    "h-4 w-4 transition-transform motion-reduce:transition-none",
                    expanded[group.id] && "rotate-90",
                  )}
                />
              </button>
              <div id={`mobile-${group.id}`} hidden={!expanded[group.id]} className="space-y-1">
                {group.items.map(({ to, label, icon: Icon }) => {
                  const active = to === activeTo;
                  return (
                    <Link
                      key={to}
                      to={to}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "flex min-h-12 items-center gap-3 rounded-xl px-3 py-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                        active
                          ? "bg-primary/10 font-semibold text-primary ring-1 ring-inset ring-primary/25"
                          : "text-sidebar-foreground/85 hover:bg-sidebar-accent/60",
                      )}
                    >
                      <Icon
                        aria-hidden="true"
                        className={cn(
                          "h-[18px] w-[18px] shrink-0",
                          active ? "text-primary" : "text-muted-foreground",
                        )}
                      />
                      {label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
