import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Download,
  ExternalLink,
  Images,
  Loader2,
  MapPin,
  RefreshCcw,
  User2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  useDownloads,
  batchDownloadAssets,
  refreshDownloads,
  type DownloadRow,
} from "@/lib/downloads-store";
import { useAssets } from "@/lib/assets-store";

export const Route = createFileRoute("/_authenticated/downloads")({
  head: () => ({
    meta: [
      { title: "Archive — InstaScanner" },
      {
        name: "description",
        content:
          "Every asset the operator has synchronized. Includes downloader, timestamp, and file metadata.",
      },
    ],
  }),
  component: DownloadsPage,
});

function formatBytes(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function formatWhen(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - then);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function DownloadsPage() {
  const { rows } = useDownloads();
  const assets = useAssets();
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(
    null,
  );

  const stats = useMemo(() => {
    const uniqueAssets = new Set(rows.map((r) => r.asset_id));
    const totalBytes = rows.reduce((s, r) => s + (r.file_size ?? 0), 0);
    const operators = new Set(rows.map((r) => r.downloaded_by).filter(Boolean));
    return {
      total: rows.length,
      uniqueAssets: uniqueAssets.size,
      totalBytes,
      operators: operators.size,
    };
  }, [rows]);

  const downloadedIds = useMemo(
    () => new Set(rows.map((r) => r.asset_id)),
    [rows],
  );

  const approvedNotYet = useMemo(
    () => assets.filter((a) => a.status === "approved" && !downloadedIds.has(a.id)),
    [assets, downloadedIds],
  );

  const onBatch = async () => {
    if (!approvedNotYet.length) {
      toast.info("No approved assets awaiting synchronization.");
      return;
    }
    setBusy({ done: 0, total: approvedNotYet.length });
    const { ok, failed } = await batchDownloadAssets(
      approvedNotYet.map((a) => ({
        id: a.id,
        username: a.username,
        media_url: a.video ?? a.thumbnail,
        thumbnail_url: a.thumbnail,
        is_video: !!a.video,
      })),
      (done, total) => setBusy({ done, total }),
    );
    setBusy(null);
    if (failed) {
      toast.warning(`Synchronized ${ok} · ${failed} require manual retry`);
    } else {
      toast.success(`Synchronized ${ok} asset${ok === 1 ? "" : "s"}`);
    }
  };

  return (
    <div className="p-6 md:p-8 space-y-6">
      <PageHeader
        eyebrow="Operator archive"
        title="Synchronized assets"
        description="Every file the operator has pulled from the network. Metadata is recorded for audit and recovery."
        status={{ label: "Archive", tone: "muted" }}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => void refreshDownloads()}
              disabled={!!busy}
            >
              <RefreshCcw className="h-3.5 w-3.5" /> Refresh
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={onBatch}
              disabled={!!busy || !approvedNotYet.length}
            >
              {busy ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Synchronizing {busy.done}/{busy.total}
                </>
              ) : (
                <>
                  <Download className="h-3.5 w-3.5" />
                  Batch synchronize
                  {approvedNotYet.length ? ` (${approvedNotYet.length})` : ""}
                </>
              )}
            </Button>
          </>
        }
      />


      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total downloads" value={stats.total.toLocaleString()} />
        <Stat
          label="Unique assets"
          value={stats.uniqueAssets.toLocaleString()}
        />
        <Stat label="Volume" value={formatBytes(stats.totalBytes)} />
        <Stat label="Operators" value={stats.operators.toLocaleString()} />
      </div>

      {/* Table */}
      <div className="soft-shadow overflow-hidden rounded-2xl border border-border bg-card">
        {rows.length === 0 ? (
          <div className="flex min-h-[42vh] items-center justify-center">
            <div className="max-w-sm px-6 py-16 text-center">
              <div className="relative mx-auto mb-6 h-24 w-24">
                <div className="absolute inset-0 rounded-3xl bg-primary/10 blur-2xl" />
                <div className="relative flex h-full w-full items-center justify-center rounded-3xl bg-gradient-to-br from-primary/20 to-primary/5 ring-1 ring-primary/20">
                  <Download className="h-10 w-10 text-primary" />
                </div>
              </div>
              <h2 className="text-lg font-semibold tracking-tight">
                Archive is empty
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                The moment an operator synchronizes an asset, it lands here with
                full metadata.
              </p>
              <div className="mt-6 flex items-center justify-center gap-2">
                <Button asChild variant="secondary" className="gap-1.5">
                  <Link to="/assets" search={{ day: "all", status: "all" }}>
                    <Images className="h-4 w-4" /> Review new assets
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead className="bg-muted/30 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Asset</th>
                  <th className="px-4 py-3 text-left font-medium">Account</th>
                  <th className="px-4 py-3 text-left font-medium">Operator</th>
                  <th className="px-4 py-3 text-left font-medium">When</th>
                  <th className="px-4 py-3 text-left font-medium">Type</th>
                  <th className="px-4 py-3 text-right font-medium">Size</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <DownloadRowView key={r.id} row={r} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function DownloadRowView({ row }: { row: DownloadRow }) {
  const thumb = row.asset?.thumbnail_url ?? row.asset?.media_url ?? null;
  const username = row.asset?.tracked_accounts?.username ?? "unknown";
  const source = row.asset?.source_url ?? null;
  const operator =
    row.operator?.display_name || row.operator?.email || "operator";

  return (
    <tr className="border-t border-border/50 hover:bg-muted/20">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
            {thumb ? (
              <img
                src={thumb}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="grid h-full w-full place-items-center text-muted-foreground">
                <Images className="h-4 w-4" />
              </div>
            )}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">
              {row.filename ?? row.asset?.id ?? "asset"}
            </div>
            {row.asset?.caption ? (
              <div className="truncate text-[11px] text-muted-foreground max-w-[280px]">
                {row.asset.caption}
              </div>
            ) : null}
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className="text-sm font-medium">@{username}</span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <User2 className="h-3.5 w-3.5" />
          <span className="truncate">{operator}</span>
        </div>
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">
        <span title={new Date(row.downloaded_at).toLocaleString()}>
          {formatWhen(row.downloaded_at)}
        </span>
      </td>
      <td className="px-4 py-3">
        <span
          className={cn(
            "inline-flex h-5 items-center rounded-md border px-1.5 text-[10px] font-medium uppercase tracking-wider",
            "border-border bg-muted/30 text-muted-foreground",
          )}
        >
          {row.media_type?.split("/")[0] ?? "file"}
        </span>
      </td>
      <td className="px-4 py-3 text-right text-sm tabular-nums text-muted-foreground">
        {formatBytes(row.file_size)}
      </td>
      <td className="px-2 py-3 text-right">
        {source ? (
          <a
            href={source}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground"
          >
            <ExternalLink className="h-3 w-3" /> Source
          </a>
        ) : null}
      </td>
    </tr>
  );
}
