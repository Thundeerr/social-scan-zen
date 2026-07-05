import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { useMemo } from "react";
import { Check, X, Download, ExternalLink, RotateCcw } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { usePosts, postActions } from "@/lib/posts-store";
import { useGlobalQuery, setGlobalQuery, matchesQuery } from "@/lib/search-store";
import type { Post } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

const DAYS = ["all", "today", "yesterday"] as const;
const STATUSES = ["all", "new", "approved", "ignored", "downloaded"] as const;
type Day = (typeof DAYS)[number];
type Status = (typeof STATUSES)[number];

const searchSchema = z.object({
  day: fallback(z.enum(DAYS), "today").default("today"),
  status: fallback(z.enum(STATUSES), "all").default("all"),
});

export const Route = createFileRoute("/posts")({
  head: () => ({ meta: [{ title: "New Posts — InstaScanner" }] }),
  validateSearch: zodValidator(searchSchema),
  component: PostsPage,
});

function matches(p: Post, day: Day, status: Status, q: string) {
  if (day !== "all" && p.day !== day) return false;
  if (status !== "all" && p.status !== status) return false;
  if (q) {
    const needle = q.toLowerCase();
    if (
      !p.username.toLowerCase().includes(needle) &&
      !p.caption.toLowerCase().includes(needle)
    ) {
      return false;
    }
  }
  return true;
}

function PostsPage() {
  const { day, status, q } = Route.useSearch();
  const navigate = useNavigate({ from: "/posts" });
  const posts = usePosts();

  const setSearch = (patch: Partial<{ day: Day; status: Status; q: string }>) =>
    navigate({
      search: (prev: { day: Day; status: Status; q: string }) => ({ ...prev, ...patch }),
      replace: true,
    });

  const dayCounts = useMemo(
    () =>
      Object.fromEntries(
        DAYS.map((d) => [d, posts.filter((p) => matches(p, d, status, q)).length]),
      ) as Record<Day, number>,
    [posts, status, q],
  );
  const statusCounts = useMemo(
    () =>
      Object.fromEntries(
        STATUSES.map((s) => [s, posts.filter((p) => matches(p, day, s, q)).length]),
      ) as Record<Status, number>,
    [posts, day, q],
  );

  const filtered = posts.filter((p) => matches(p, day, status, q));

  return (
    <div className="p-6 md:p-8">
      <PageHeader
        title="New Posts"
        description="Review, approve, or ignore freshly detected posts."
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
              {s}
              <span className="text-[10px] tabular-nums text-muted-foreground/80">
                {statusCounts[s]}
              </span>
            </button>
          ))}
        </div>

        <div className="relative ml-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setSearch({ q: e.target.value })}
            placeholder="Search username or caption…"
            className="pl-9 h-8 w-64"
          />
        </div>

        {(day !== "today" || status !== "all" || q) && (
          <button
            onClick={() => setSearch({ day: "today", status: "all", q: "" })}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            Reset
          </button>
        )}
      </div>


      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/30 p-16 text-center">
          <p className="text-sm text-muted-foreground">No posts in this bucket yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((p) => (
            <div
              key={p.id}
              className="soft-shadow group relative overflow-hidden rounded-xl border border-border bg-card"
            >
              <div className="relative aspect-square overflow-hidden bg-muted">
                <img
                  src={p.thumbnail}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.05]"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/0 to-black/0 opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="absolute inset-x-0 bottom-0 p-3 translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="text-xs font-medium text-white">@{p.username}</div>
                    <div className="text-[10px] text-white/70">· {p.detectedAt}</div>
                  </div>
                  <p className="text-[11px] text-white/90 line-clamp-2 mb-2">{p.caption}</p>
                  <div className="flex items-center gap-1">
                    <IconBtn
                      as="a"
                      href={`https://instagram.com/${p.username}`}
                      target="_blank"
                      rel="noreferrer noopener"
                      title="View"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </IconBtn>
                    {p.status === "new" ? (
                      <>
                        <IconBtn
                          onClick={() => postActions.download(p.id)}
                          title="Download"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </IconBtn>
                        <IconBtn
                          className="text-success"
                          onClick={() => postActions.approve(p.id)}
                          title="Approve"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </IconBtn>
                        <IconBtn
                          className="text-destructive"
                          onClick={() => postActions.ignore(p.id)}
                          title="Ignore"
                        >
                          <X className="h-3.5 w-3.5" />
                        </IconBtn>
                      </>
                    ) : (
                      <IconBtn
                        onClick={() => postActions.reset(p.id)}
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
                  {p.status === "new" ? p.detectedAt : p.status}
                </span>
              </div>
            </div>
          ))}
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

