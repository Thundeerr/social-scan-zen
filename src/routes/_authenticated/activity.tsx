import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  Ban,
  Check,
  Filter,
  LogIn,
  LogOut,
  Radar,
  RefreshCcw,
  ScanLine,
  Search,
  Sparkles,
  UserMinus,
  UserPlus,
  UserRoundCog,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import {
  useActivityFeed,
  refreshActivity,
  ACTIVITY_TYPES,
  type ActivityEventType,
  type ActivityRow,
} from "@/lib/activity-log";

export const Route = createFileRoute("/_authenticated/activity")({
  head: () => ({
    meta: [
      { title: "Activity — InstaScanner" },
      {
        name: "description",
        content:
          "Immutable log of every operator action and network event across the InstaScanner platform.",
      },
    ],
  }),
  component: ActivityPage,
});

type FilterKind = "all" | "auth" | "accounts" | "scans" | "assets" | "errors";

const KIND_TO_TYPES: Record<FilterKind, ActivityEventType[] | null> = {
  all: null,
  auth: ["login", "logout"],
  accounts: ["account_added", "account_edited", "account_removed"],
  scans: [
    "scan_started",
    "scan_completed",
    "scan_failed",
    "scan_retry_scheduled",
    "asset_detected",
  ],
  assets: ["asset_downloaded", "asset_kept", "asset_dismissed"],
  errors: ["error", "scan_failed"],
};

const KIND_LABELS: Record<FilterKind, string> = {
  all: "All activity",
  auth: "Sessions",
  accounts: "Accounts",
  scans: "Scanner",
  assets: "Assets",
  errors: "Errors",
};

function formatTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - then);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function ActivityPage() {
  const { rows, loaded } = useActivityFeed();
  const [kind, setKind] = useState<FilterKind>("all");
  const [type, setType] = useState<ActivityEventType | "all">("all");
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const kindTypes = KIND_TO_TYPES[kind];
    const query = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (kindTypes && !kindTypes.includes(r.event_type as ActivityEventType))
        return false;
      if (type !== "all" && r.event_type !== type) return false;
      if (query) {
        const hay = `${r.description} ${r.event_type}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });
  }, [rows, kind, type, q]);

  const kpi = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.event_type] = (counts[r.event_type] ?? 0) + 1;
    return {
      total: rows.length,
      errors: (counts["error"] ?? 0) + (counts["scan_failed"] ?? 0),
      scans:
        (counts["scan_completed"] ?? 0) +
        (counts["scan_started"] ?? 0) +
        (counts["scan_failed"] ?? 0),
      downloads: counts["asset_downloaded"] ?? 0,
    };
  }, [rows]);

  return (
    <div className="p-6 md:p-8 space-y-6">
      <PageHeader
        eyebrow="Immutable audit"
        title="Activity log"
        description="Every operator action and autonomous event, newest first. Entries cannot be edited or removed."
        status={{ label: "Realtime", tone: "success", live: true }}
        actions={
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => void refreshActivity()}
          >
            <RefreshCcw className="h-3.5 w-3.5" /> Refresh
          </Button>
        }
      />


      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total events" value={kpi.total.toLocaleString()} />
        <Stat label="Scans" value={kpi.scans.toLocaleString()} />
        <Stat label="Downloads" value={kpi.downloads.toLocaleString()} />
        <Stat
          label="Errors"
          value={kpi.errors.toLocaleString()}
          tone={kpi.errors ? "warn" : "muted"}
        />
      </div>

      {/* Filter bar */}
      <div className="soft-shadow rounded-2xl border border-border bg-card p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="-mx-1 flex items-center gap-1 overflow-x-auto rounded-md border border-border bg-muted/20 p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {(Object.keys(KIND_LABELS) as FilterKind[]).map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-[6px] px-2.5 py-1 text-[11px] font-medium transition-colors",
                  kind === k
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {KIND_LABELS[k]}
              </button>
            ))}
          </div>

          <div className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
            <Filter className="h-3.5 w-3.5 shrink-0" />
            <select
              value={type}
              onChange={(e) =>
                setType(e.target.value as ActivityEventType | "all")
              }
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-primary/40 sm:flex-none"
            >
              <option value="all">Every event type</option>
              {ACTIVITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {labelForType(t)}
                </option>
              ))}
            </select>
          </div>

          <div className="relative w-full sm:ml-auto sm:w-auto sm:min-w-[220px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search descriptions"
              className="h-8 pl-7 text-xs"
            />
          </div>
        </div>
      </div>

      {/* Feed */}
      <div className="soft-shadow rounded-2xl border border-border bg-card">
        {!loaded ? (
          <div className="flex min-h-[30vh] items-center justify-center text-xs text-muted-foreground">
            Loading log…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex min-h-[30vh] items-center justify-center px-6 py-16 text-center">
            <div className="max-w-sm">
              <div className="relative mx-auto mb-5 h-16 w-16">
                <div className="absolute inset-0 rounded-3xl bg-primary/10 blur-2xl" />
                <div className="relative flex h-full w-full items-center justify-center rounded-3xl bg-gradient-to-br from-primary/20 to-primary/5 ring-1 ring-primary/20">
                  <Sparkles className="h-6 w-6 text-primary" />
                </div>
              </div>
              <h2 className="text-sm font-semibold tracking-tight">
                No matching events
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Adjust the filters or wait — the network is monitoring.
              </p>
            </div>
          </div>
        ) : (
          <ol className="divide-y divide-border/60">
            {filtered.map((row) => (
              <ActivityItem key={row.id} row={row} />
            ))}
          </ol>
        )}
      </div>

      <div className="text-center text-[11px] text-muted-foreground">
        {filtered.length.toLocaleString()} shown · {rows.length.toLocaleString()}{" "}
        recorded · log is append-only
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "muted" | "warn";
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 text-lg font-semibold tabular-nums",
          tone === "warn" && "text-warning",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function ActivityItem({ row }: { row: ActivityRow }) {
  const tone = toneForType(row.event_type);
  const Icon = iconForType(row.event_type);
  return (
    <li className="flex items-start gap-3 px-3 py-3 hover:bg-muted/20 sm:px-4">
      <div
        className={cn(
          "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border",
          tone.border,
          tone.bg,
          tone.text,
        )}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 flex-1 truncate text-sm text-foreground">
            {row.description}
          </span>
          <span
            className={cn(
              "inline-flex h-4 shrink-0 items-center rounded-sm border px-1 text-[9px] font-medium uppercase tracking-wider",
              tone.border,
              tone.text,
            )}
          >
            {labelForType(row.event_type)}
          </span>
        </div>
        {row.metadata && Object.keys(row.metadata).length > 0 ? (
          <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
            {formatMeta(row.metadata)}
          </div>
        ) : null}
      </div>
      <div
        className="shrink-0 whitespace-nowrap text-[11px] tabular-nums text-muted-foreground"
        title={new Date(row.created_at).toLocaleString()}
      >
        {formatTime(row.created_at)}
      </div>
    </li>
  );
}

function labelForType(t: string): string {
  switch (t) {
    case "login":
      return "Sign in";
    case "logout":
      return "Sign out";
    case "account_added":
      return "Track";
    case "account_edited":
      return "Edit";
    case "account_removed":
      return "Untrack";
    case "scan_started":
      return "Scan start";
    case "scan_completed":
      return "Scan done";
    case "scan_failed":
      return "Scan fail";
    case "scan_retry_scheduled":
      return "Retry";
    case "asset_detected":
      return "Detected";
    case "asset_downloaded":
      return "Download";
    case "asset_kept":
      return "Kept";
    case "asset_dismissed":
      return "Dismiss";
    case "error":
      return "Error";
    default:
      return t;
  }
}

function iconForType(t: string) {
  switch (t) {
    case "login":
      return LogIn;
    case "logout":
      return LogOut;
    case "account_added":
      return UserPlus;
    case "account_edited":
      return UserRoundCog;
    case "account_removed":
      return UserMinus;
    case "scan_started":
      return Radar;
    case "scan_completed":
      return ScanLine;
    case "scan_failed":
      return AlertTriangle;
    case "scan_retry_scheduled":
      return RefreshCcw;
    case "asset_detected":
      return Sparkles;
    case "asset_downloaded":
      return ArrowDownToLine;
    case "asset_kept":
      return Check;
    case "asset_dismissed":
      return Ban;
    case "error":
      return AlertTriangle;
    default:
      return Activity;
  }
}

function toneForType(t: string): {
  border: string;
  bg: string;
  text: string;
} {
  switch (t) {
    case "error":
    case "scan_failed":
      return {
        border: "border-warning/30",
        bg: "bg-warning/10",
        text: "text-warning",
      };
    case "asset_kept":
    case "scan_completed":
    case "login":
    case "asset_detected":
      return {
        border: "border-success/30",
        bg: "bg-success/10",
        text: "text-success",
      };
    case "account_added":
    case "asset_downloaded":
      return {
        border: "border-primary/30",
        bg: "bg-primary/10",
        text: "text-primary",
      };
    default:
      return {
        border: "border-border",
        bg: "bg-muted/30",
        text: "text-muted-foreground",
      };
  }
}

function formatMeta(meta: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(meta)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "object") continue;
    parts.push(`${k}=${String(v)}`);
    if (parts.length >= 4) break;
  }
  return parts.join(" · ");
}
