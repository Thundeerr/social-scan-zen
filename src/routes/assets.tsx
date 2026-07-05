import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { useMemo } from "react";
import { Check, X, Download, ExternalLink, RotateCcw, Star } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { useAssets, assetActions } from "@/lib/assets-store";
import { useGlobalQuery, setGlobalQuery, matchesQuery } from "@/lib/search-store";
import { useFavorites, toggleFavorite } from "@/lib/favorites-store";
import {
  useRegisterVisibleAssets,
  selectAsset,
  useSelection,
} from "@/lib/selection-store";
import type { Asset } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

const DAYS = ["all", "today", "yesterday"] as const;
const STATUSES = ["all", "new", "approved", "ignored", "downloaded"] as const;
type Day = (typeof DAYS)[number];
type Status = (typeof STATUSES)[number];

const STATUS_LABEL: Record<Status, string> = {
  all: "all",
  new: "new",
  approved: "approved",
  ignored: "archived",
  downloaded: "synchronized",
};

const searchSchema = z.object({
  day: fallback(z.enum(DAYS), "today").default("today"),
  status: fallback(z.enum(STATUSES), "all").default("all"),
});

export const Route = createFileRoute("/assets")({
  head: () => ({ meta: [{ title: "New Assets — InstaScanner" }] }),
  validateSearch: zodValidator(searchSchema),
  component: AssetsPage,
});

function matches(a: Asset, day: Day, status: Status, q: string) {
  if (day !== "all" && a.day !== day) return false;
  if (status !== "all" && a.status !== status) return false;
  return matchesQuery(a, q);
}

function AssetsPage() {
  const { day, status } = Route.useSearch();
  const q = useGlobalQuery();
  const navigate = useNavigate({ from: "/assets" });
  const assets = useAssets();

  const setSearch = (patch: Partial<{ day: Day; status: Status }>) =>
    navigate({
      search: (prev: { day: Day; status: Status }) => ({ ...prev, ...patch }),
      replace: true,
    });

  const dayCounts = useMemo(
    () =>
      Object.fromEntries(
        DAYS.map((d) => [d, assets.filter((a) => matches(a, d, status, q)).length]),
      ) as Record<Day, number>,
    [assets, status, q],
  );
  const statusCounts = useMemo(
    () =>
      Object.fromEntries(
        STATUSES.map((s) => [s, assets.filter((a) => matches(a, day, s, q)).length]),
      ) as Record<Status, number>,
    [assets, day, q],
  );

  const filtered = useMemo(
    () => assets.filter((a) => matches(a, day, status, q)),
    [assets, day, status, q],
  );
  useRegisterVisibleAssets(
    useMemo(() => filtered.map((a) => a.id), [filtered]),
  );
  const { selectedId } = useSelection();
  const favorites = useFavorites();

  return (
    <div className="p-6 md:p-8">
      <PageHeader
        title="New Assets"
        description={
          q
            ? `Showing matches for “${q}”.`
            : "Freshly detected assets delivered by the scanner."
        }
      />

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
          {DAYS.map((k) => (
            <button
              key={k}
              onClick={() => setSearch({ day: k })}
              className={cn(
                "px-3 h-8 text-xs rounded-md capitalize transition-colors flex items-center gap-1.5",
                day === k
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {k}
              <span
                className={cn(
                  "text-[10px] tabular-nums rounded px-1",
                  day === k ? "bg-primary/20" : "bg-muted",
                )}
              >
                {dayCounts[k]}
              </span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 flex-wrap">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setSearch({ status: s })}
              className={cn(
                "h-8 px-2.5 text-xs rounded-full border capitalize transition-colors flex items-center gap-1.5",
                status === s
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {STATUS_LABEL[s]}
              <span className="text-[10px] tabular-nums text-muted-foreground/80">
                {statusCounts[s]}
              </span>
            </button>
          ))}
        </div>

        {(day !== "today" || status !== "all" || q) && (
          <button
            onClick={() => {
              setSearch({ day: "today", status: "all" });
              setGlobalQuery("");
            }}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            Reset
          </button>
        )}
      </div>



      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/30 p-16 text-center">
          <p className="text-sm text-muted-foreground">No new assets.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((p) => {
            const selected = p.id === selectedId;
            const sourceUrl = `https://instagram.com/${p.username}`;
            const isFav = favorites.has(p.id);
            return (
              <div
                key={p.id}
                data-asset-id={p.id}
                data-asset-url={sourceUrl}
                onClick={() => selectAsset(p.id)}
                className={cn(
                  "soft-shadow group relative overflow-hidden rounded-xl border bg-card cursor-pointer transition-colors",
                  selected
                    ? "border-primary/60 ring-1 ring-primary/40"
                    : "border-border hover:border-primary/30",
                )}
              >
                <div className="relative aspect-square overflow-hidden bg-muted">
                  <img
                    src={p.thumbnail}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.05]"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/0 to-black/0 opacity-0 group-hover:opacity-100 transition-opacity" />
                  {selected && (
                    <div className="absolute top-2 left-2 rounded-md bg-primary/90 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider text-primary-foreground">
                      Selected
                    </div>
                  )}
                  {isFav && (
                    <div className="absolute top-2 right-2 rounded-md bg-black/60 backdrop-blur p-1">
                      <Star className="h-3 w-3 fill-warning text-warning" />
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 p-3 translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="text-xs font-medium text-white">@{p.username}</div>
                      <div className="text-[10px] text-white/70">· {p.detectedAt}</div>
                    </div>
                    <p className="text-[11px] text-white/90 line-clamp-2 mb-2">{p.caption}</p>
                    <div className="flex items-center gap-1">
                      <IconBtn
                        as="a"
                        href={sourceUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        title="Open original source (R)"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </IconBtn>
                      <IconBtn
                        className={cn(isFav && "text-warning")}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFavorite(p.id);
                        }}
                        title="Toggle favorite (F)"
                      >
                        <Star className={cn("h-3.5 w-3.5", isFav && "fill-warning")} />
                      </IconBtn>
                      {p.status === "new" ? (
                        <>
                          <IconBtn
                            onClick={(e) => {
                              e.stopPropagation();
                              assetActions.download(p.id);
                            }}
                            title="Synchronize (D)"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </IconBtn>
                          <IconBtn
                            className="text-success"
                            onClick={(e) => {
                              e.stopPropagation();
                              assetActions.approve(p.id);
                            }}
                            title="Approve (A)"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </IconBtn>
                          <IconBtn
                            className="text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              assetActions.ignore(p.id);
                            }}
                            title="Archive (I)"
                          >
                            <X className="h-3.5 w-3.5" />
                          </IconBtn>
                        </>
                      ) : (
                        <IconBtn
                          onClick={(e) => {
                            e.stopPropagation();
                            assetActions.reset(p.id);
                          }}
                          title="Reset to new"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </IconBtn>
                      )}
                    </div>
                  </div>
                </div>
                <div className="px-3 py-2 flex items-center justify-between">
                  <span className="text-xs font-medium truncate">@{p.username}</span>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground capitalize">
                    {p.status === "new" ? p.detectedAt : STATUS_LABEL[p.status as Status]}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const iconBtnClass =
  "h-7 w-7 rounded-md bg-white/10 hover:bg-white/20 backdrop-blur flex items-center justify-center text-white transition-colors";

function IconBtn({
  children,
  className,
  as,
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
  as?: "a" | "button";
} & React.HTMLAttributes<HTMLElement> &
  Partial<React.AnchorHTMLAttributes<HTMLAnchorElement>>) {
  if (as === "a") {
    return (
      <a className={cn(iconBtnClass, className)} {...(rest as React.AnchorHTMLAttributes<HTMLAnchorElement>)}>
        {children}
      </a>
    );
  }
  return (
    <button className={cn(iconBtnClass, className)} {...(rest as React.ButtonHTMLAttributes<HTMLButtonElement>)}>
      {children}
    </button>
  );
}
