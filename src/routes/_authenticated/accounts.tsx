import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Plus, MoreHorizontal, Search, Loader2, Radar, X } from "lucide-react";
import { toast } from "sonner";
import { scanAccountNowFn } from "@/lib/scanner.functions";
import { getTrackedAccountAvatarsFn } from "@/lib/avatar.functions";
import { trackedAccountsKey } from "@/lib/db-queries";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/page-header";
import { getAvatar } from "@/lib/mock-data";
import { TierChip } from "@/components/operator-score";
import { cn } from "@/lib/utils";
import {
  useTrackedAccounts,
  useCreateTrackedAccount,
  useUpdateTrackedAccount,
  useDeleteTrackedAccount,
  useWatchlists,
  useWatchlistAssignments,
  useSetWatchlistAssignment,
  useAccountAssetCounts,
  type TrackedAccount,
  type Watchlist,
} from "@/lib/db-queries";

export const Route = createFileRoute("/_authenticated/accounts")({
  head: () => ({ meta: [{ title: "Tracked Accounts — InstaScanner" }] }),
  component: AccountsPage,
});

type Tier = "S" | "A" | "B" | "C";
const TIERS: Tier[] = ["S", "A", "B", "C"];
const TIER_LABEL: Record<Tier, string> = {
  S: "S — Mission Critical",
  A: "A — High Priority",
  B: "B — Normal",
  C: "C — Low Priority",
};

// Approximate scan cadence per tier (minutes)
const TIER_CADENCE_MIN: Record<Tier, number> = { S: 5, A: 15, B: 30, C: 60 };

const USERNAME_RE = /^[a-z0-9._]{1,30}$/;

function timeAgo(iso: string | null) {
  if (!iso) return "—";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

function nextScanLabel(a: TrackedAccount) {
  if (a.status === "paused") return "paused";
  const cadence = TIER_CADENCE_MIN[a.tier as Tier] ?? 30;
  const last = a.last_scan_at ? new Date(a.last_scan_at).getTime() : Date.now();
  const next = last + cadence * 60_000;
  const s = Math.max(0, (next - Date.now()) / 1000);
  if (s < 60) return "imminent";
  if (s < 3600) return `in ${Math.ceil(s / 60)} min`;
  return `in ${Math.ceil(s / 3600)} hr`;
}

function AccountsPage() {
  const { data: dbRows = [], isLoading } = useTrackedAccounts();
  const { data: watchlists = [] } = useWatchlists();
  const { data: assignments = [] } = useWatchlistAssignments();
  const { data: assetCounts = {} } = useAccountAssetCounts();

  const createAccount = useCreateTrackedAccount();
  const updateAccount = useUpdateTrackedAccount();
  const deleteAccount = useDeleteTrackedAccount();
  const setAssignment = useSetWatchlistAssignment();

  const scanNow = useServerFn(scanAccountNowFn);
  const getTrackedAccountAvatars = useServerFn(getTrackedAccountAvatarsFn);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [scanning, setScanning] = useState<Record<string, boolean>>({});
  const avatarUsernames = useMemo(
    () => Array.from(new Set(dbRows.map((a) => a.username))).sort(),
    [dbRows],
  );
  const { data: accountAvatars = {} } = useQuery({
    queryKey: ["tracked_account_avatars", avatarUsernames],
    enabled: avatarUsernames.length > 0,
    staleTime: 6 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: () => getTrackedAccountAvatars({ data: { usernames: avatarUsernames } }),
  });

  async function handleScanNow(a: TrackedAccount) {
    if (scanning[a.id]) return;
    setScanning((s) => ({ ...s, [a.id]: true }));
    const t = toast.loading(`Scanning @${a.username}…`);
    try {
      const r = await scanNow({ data: { accountId: a.id } });
      qc.invalidateQueries({ queryKey: trackedAccountsKey });
      if (r.status === "failed") {
        toast.error(`Scan failed for @${a.username}`, {
          id: t,
          description: r.error ?? "Provider returned an error",
        });
      } else if (r.inserted > 0) {
        toast.success(`Found ${r.inserted} new asset${r.inserted === 1 ? "" : "s"} from @${a.username}`, {
          id: t,
          action: {
            label: "View in Inbox",
            onClick: () =>
              navigate({
                to: "/assets",
                search: { day: "all", status: "all" },
              }),
          },
        });
      } else {
        toast(`No new assets from @${a.username}`, {
          id: t,
          description:
            r.duplicates > 0
              ? `${r.duplicates} already in archive · last seen refreshed`
              : r.detected > 0
                ? `${r.detected} posts checked, all already archived`
                : "Provider returned no posts",
        });
      }
    } catch (err) {
      toast.error(`Scan failed for @${a.username}`, {
        id: t,
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setScanning((s) => {
        const next = { ...s };
        delete next[a.id];
        return next;
      });
    }
  }

  // ---- Batch scan queue ---------------------------------------------------
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [queue, setQueue] = useState<null | {
    ids: string[];
    index: number; // index of the account currently scanning
    startedAt: number;
    nowTick: number; // triggers re-render for the elapsed clock
    results: Array<{
      id: string;
      username: string;
      status: "pending" | "running" | "ok" | "failed";
      inserted: number;
      error?: string;
    }>;
    cancelled: boolean;
  }>(null);

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runQueue(ids: string[]) {
    if (!ids.length || queue) return;
    const usernameById = new Map(dbRows.map((a) => [a.id, a.username]));
    const initialResults = ids.map((id) => ({
      id,
      username: usernameById.get(id) ?? id.slice(0, 6),
      status: "pending" as const,
      inserted: 0,
    }));
    setQueue({
      ids,
      index: 0,
      startedAt: Date.now(),
      nowTick: Date.now(),
      results: initialResults,
      cancelled: false,
    });

    // 1Hz ticker so elapsed / ETA update while scanning.
    const ticker = window.setInterval(() => {
      setQueue((q) => (q ? { ...q, nowTick: Date.now() } : q));
    }, 1000);

    let totalInserted = 0;
    let failed = 0;

    for (let i = 0; i < ids.length; i++) {
      // Read latest cancel state.
      let cancelled = false;
      setQueue((q) => {
        if (!q) return q;
        cancelled = q.cancelled;
        return { ...q, index: i, results: q.results.map((r, idx) => idx === i ? { ...r, status: "running" } : r) };
      });
      if (cancelled) break;

      try {
        const r = await scanNow({ data: { accountId: ids[i] } });
        if (r.status === "failed") {
          failed++;
          setQueue((q) =>
            q
              ? {
                  ...q,
                  results: q.results.map((row, idx) =>
                    idx === i
                      ? { ...row, status: "failed", error: r.error ?? "Provider error" }
                      : row,
                  ),
                }
              : q,
          );
        } else {
          totalInserted += r.inserted;
          setQueue((q) =>
            q
              ? {
                  ...q,
                  results: q.results.map((row, idx) =>
                    idx === i ? { ...row, status: "ok", inserted: r.inserted } : row,
                  ),
                }
              : q,
          );
        }
      } catch (err) {
        failed++;
        setQueue((q) =>
          q
            ? {
                ...q,
                results: q.results.map((row, idx) =>
                  idx === i
                    ? { ...row, status: "failed", error: err instanceof Error ? err.message : String(err) }
                    : row,
                ),
              }
            : q,
        );
        // Continue with the next account — one failure must not stop the queue.
      }
    }

    window.clearInterval(ticker);
    qc.invalidateQueries({ queryKey: trackedAccountsKey });

    if (totalInserted > 0) {
      toast.success(
        `Queue complete · ${totalInserted} new asset${totalInserted === 1 ? "" : "s"}`,
        {
          description: failed ? `${failed} account${failed === 1 ? "" : "s"} failed` : undefined,
          action: {
            label: "View in Inbox",
            onClick: () =>
              navigate({ to: "/assets", search: { day: "all", status: "all" } }),
          },
        },
      );
    } else if (failed) {
      toast.error(`Queue finished · ${failed} failed, no new assets`);
    } else {
      toast(`Queue complete · no new assets`);
    }
  }

  function cancelQueue() {
    setQueue((q) => (q ? { ...q, cancelled: true } : q));
  }

  function closeQueue() {
    setQueue(null);
    setSelected(new Set());
  }

  const assignmentMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const a of assignments) m[a.account_id] = a.watchlist_id;
    return m;
  }, [assignments]);

  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "paused">("all");
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<TrackedAccount | null>(null);

  const filtered = dbRows.filter((a) => {
    if (filter !== "all" && a.status !== filter) return false;
    if (q && !a.username.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  function handleCreate(input: {
    username: string;
    displayName: string;
    tier: Tier;
    watchlistId: string | null;
    monitoring: boolean;
    notes?: string;
  }) {
    createAccount.mutate(
      {
        username: input.username,
        display_name: input.displayName,
        tier: input.tier,
        status: input.monitoring ? "active" : "paused",
        notes: input.notes ?? null,
      },
      {
        onSuccess: async (row) => {
          if (input.watchlistId) {
            await setAssignment.mutateAsync({
              accountId: row.id,
              watchlistId: input.watchlistId,
            });
          }
          toast.success(`@${row.username} is now being monitored`);
          setAddOpen(false);
        },
        onError: (e: unknown) => {
          const msg = e instanceof Error ? e.message : "Failed to add account";
          if (/duplicate key|unique/i.test(msg)) {
            toast.error("Already tracking this account");
          } else {
            toast.error(msg);
          }
        },
      },
    );
  }

  function handleEdit(
    id: string,
    input: {
      displayName: string;
      tier: Tier;
      watchlistId: string | null;
      monitoring: boolean;
      notes?: string;
    },
  ) {
    updateAccount.mutate(
      {
        id,
        patch: {
          display_name: input.displayName,
          tier: input.tier,
          status: input.monitoring ? "active" : "paused",
          notes: input.notes ?? null,
        },
      },
      {
        onSuccess: async () => {
          await setAssignment.mutateAsync({
            accountId: id,
            watchlistId: input.watchlistId,
          });
          toast.success("Account updated");
          setEditing(null);
        },
        onError: (e: unknown) =>
          toast.error(e instanceof Error ? e.message : "Update failed"),
      },
    );
  }

  function toggleMonitoring(a: TrackedAccount) {
    updateAccount.mutate({
      id: a.id,
      patch: { status: a.status === "active" ? "paused" : "active" },
    });
  }

  function remove(a: TrackedAccount) {
    deleteAccount.mutate(a.id, {
      onSuccess: () => toast(`Removed @${a.username}`),
      onError: (e: unknown) =>
        toast.error(e instanceof Error ? e.message : "Failed to remove"),
    });
  }

  const watchlistNameById = useMemo(() => {
    const m: Record<string, Watchlist> = {};
    for (const w of watchlists) m[w.id] = w;
    return m;
  }, [watchlists]);

  return (
    <div className="p-6 md:p-8 space-y-6">
      <PageHeader
        eyebrow="Watchlist active"
        title="Tracked Accounts"
        description={`${dbRows.length} accounts under active surveillance. Ranked by operator priority tier.`}
        status={{ label: "Monitoring", tone: "success", live: true }}
        actions={
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button className="gap-1.5">
                <Plus className="h-4 w-4" /> Add Account
              </Button>
            </DialogTrigger>
            <AccountFormDialog
              mode="create"
              existingUsernames={dbRows.map((a) => a.username)}
              watchlists={watchlists}
              submitting={createAccount.isPending}
              onSubmit={handleCreate}
            />
          </Dialog>
        }
      />


      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by username…"
            className="pl-9 h-9 w-64"
          />
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
          {(["all", "active", "paused"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={cn(
                "px-3 h-7 text-xs rounded-md capitalize transition-colors",
                filter === k
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {k}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
          {selected.size > 0 && (
            <>
              <span>{selected.size} selected</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => setSelected(new Set())}
                disabled={!!queue}
              >
                Clear
              </Button>
              <Button
                size="sm"
                className="h-7 gap-1.5"
                onClick={() => void runQueue(Array.from(selected))}
                disabled={!!queue}
              >
                <Radar className="h-3.5 w-3.5" />
                Scan Selected ({selected.size})
              </Button>
            </>
          )}
          <span>{filtered.length} results</span>
        </div>
      </div>

      {queue && (
        <ScanQueuePanel
          queue={queue}
          onCancel={cancelQueue}
          onClose={closeQueue}
        />
      )}

      <div className="soft-shadow rounded-xl border border-border bg-card overflow-hidden">

        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10">
                <Checkbox
                  aria-label="Select all"
                  disabled={!!queue || filtered.length === 0}
                  checked={
                    filtered.length > 0 &&
                    filtered.every((a) => selected.has(a.id))
                  }
                  onCheckedChange={(v) => {
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (v) filtered.forEach((a) => next.add(a.id));
                      else filtered.forEach((a) => next.delete(a.id));
                      return next;
                    });
                  }}
                />
              </TableHead>
              <TableHead className="min-w-[10rem] md:w-[28%]">Account</TableHead>
              <TableHead className="hidden lg:table-cell">Priority</TableHead>
              <TableHead className="hidden xl:table-cell">Watchlist</TableHead>
              <TableHead className="hidden md:table-cell">Status</TableHead>
              <TableHead className="hidden lg:table-cell">Last Scan</TableHead>
              <TableHead className="hidden xl:table-cell">Next Scan</TableHead>
              <TableHead className="hidden md:table-cell text-right">Total Assets</TableHead>
              <TableHead className="w-[92px] md:w-[160px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((a) => {
              const wl = assignmentMap[a.id]
                ? watchlistNameById[assignmentMap[a.id]]
                : null;
              return (
                <TableRow key={a.id} data-selected={selected.has(a.id) ? "true" : undefined}>
                  <TableCell>
                    <Checkbox
                      aria-label={`Select ${a.username}`}
                      disabled={!!queue}
                      checked={selected.has(a.id)}
                      onCheckedChange={() => toggleSelected(a.id)}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <img
                        src={accountAvatars[a.username] ?? getAvatar(a.username)}
                        alt=""
                        loading="lazy"
                        onError={(e) => {
                          const img = e.currentTarget;
                          const fb = getAvatar(a.username);
                          if (img.src !== fb) img.src = fb;
                        }}
                        className="h-9 w-9 shrink-0 rounded-full ring-1 ring-border bg-muted object-cover"
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">
                          @{a.username}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {a.display_name}
                        </div>
                        {/* Mobile-only compact meta row */}
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 md:hidden">
                          <TierChip tier={a.tier as Tier} size="sm" />
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px]",
                              a.status === "active"
                                ? "border-success/30 bg-success/10 text-success"
                                : "border-muted-foreground/30 bg-muted text-muted-foreground",
                            )}
                          >
                            <span
                              className={cn(
                                "h-1 w-1 rounded-full",
                                a.status === "active" ? "bg-success" : "bg-muted-foreground",
                              )}
                            />
                            {a.status}
                          </span>
                          <span className="text-[10px] text-muted-foreground tabular-nums">
                            {assetCounts[a.id] ?? 0} assets · {timeAgo(a.last_scan_at)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <TierChip tier={a.tier as Tier} size="sm" showLabel />
                  </TableCell>
                  <TableCell className="hidden xl:table-cell">
                    {wl ? (
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-foreground"
                        style={
                          wl.color
                            ? { boxShadow: `inset 3px 0 0 ${wl.color}` }
                            : undefined
                        }
                      >
                        {wl.name}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]",
                        a.status === "active"
                          ? "border-success/30 bg-success/10 text-success"
                          : "border-muted-foreground/30 bg-muted text-muted-foreground",
                      )}
                    >
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          a.status === "active"
                            ? "bg-success"
                            : "bg-muted-foreground",
                        )}
                      />
                      {a.status}
                    </span>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                    {timeAgo(a.last_scan_at)}
                  </TableCell>
                  <TableCell className="hidden xl:table-cell text-sm text-muted-foreground">
                    {nextScanLabel(a)}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-right tabular-nums text-sm">
                    {assetCounts[a.id] ?? 0}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-8 gap-1.5 px-2 md:px-3"
                        disabled={!!scanning[a.id] || !!queue}
                        onClick={() => void handleScanNow(a)}
                        aria-label="Scan now"
                      >
                        {scanning[a.id] ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            <span className="hidden md:inline">Scanning</span>
                          </>
                        ) : (
                          <>
                            <Radar className="h-3.5 w-3.5" />
                            <span className="hidden md:inline">Scan Now</span>
                          </>
                        )}
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setEditing(a)}>
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => toggleMonitoring(a)}>
                            {a.status === "active"
                              ? "Disable monitoring"
                              : "Enable monitoring"}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() => remove(a)}
                          >
                            Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="h-24 text-center text-sm text-muted-foreground"
                >
                  {isLoading ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
                    </span>
                  ) : (
                    "No accounts match your filters."
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && (
          <AccountFormDialog
            mode="edit"
            initial={{
              username: editing.username,
              displayName: editing.display_name,
              tier: (editing.tier as Tier) ?? "B",
              watchlistId: assignmentMap[editing.id] ?? null,
              monitoring: editing.status === "active",
              notes: editing.notes ?? "",
            }}
            existingUsernames={dbRows
              .filter((a) => a.id !== editing.id)
              .map((a) => a.username)}
            watchlists={watchlists}
            submitting={updateAccount.isPending}
            onSubmit={(v) => handleEdit(editing.id, v)}
          />
        )}
      </Dialog>
    </div>
  );
}

function AccountFormDialog({
  mode,
  initial,
  existingUsernames,
  watchlists,
  submitting,
  onSubmit,
}: {
  mode: "create" | "edit";
  initial?: {
    username: string;
    displayName: string;
    tier: Tier;
    watchlistId: string | null;
    monitoring: boolean;
    notes: string;
  };
  existingUsernames: string[];
  watchlists: Watchlist[];
  submitting: boolean;
  onSubmit: (input: {
    username: string;
    displayName: string;
    tier: Tier;
    watchlistId: string | null;
    monitoring: boolean;
    notes?: string;
  }) => void;
}) {
  const [username, setUsername] = useState(initial?.username ?? "");
  const [displayName, setDisplayName] = useState(initial?.displayName ?? "");
  const [tier, setTier] = useState<Tier>(initial?.tier ?? "B");
  const [watchlistId, setWatchlistId] = useState<string>(
    initial?.watchlistId ?? "__none__",
  );
  const [monitoring, setMonitoring] = useState(initial?.monitoring ?? true);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  const cleanUsername = username.trim().replace(/^@/, "").toLowerCase();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "create") {
      if (!cleanUsername) return setError("Username is required");
      if (!USERNAME_RE.test(cleanUsername))
        return setError("Only letters, numbers, dots and underscores");
      if (existingUsernames.includes(cleanUsername))
        return setError("You are already tracking this account");
    }
    if (!displayName.trim().length && !cleanUsername)
      return setError("Display name required");

    onSubmit({
      username: cleanUsername,
      displayName: displayName.trim() || cleanUsername,
      tier,
      watchlistId: watchlistId === "__none__" ? null : watchlistId,
      monitoring,
      notes: notes.trim() || undefined,
    });
  }

  return (
    <DialogContent className="sm:max-w-[480px]">
      <DialogHeader>
        <DialogTitle>
          {mode === "create" ? "Add Instagram account" : "Edit account"}
        </DialogTitle>
        <DialogDescription>
          {mode === "create"
            ? "The scanner will begin monitoring this account on the next cycle."
            : "Update priority, watchlist and monitoring for this account."}
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="username">Username</Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              @
            </span>
            <Input
              id="username"
              value={username}
              disabled={mode === "edit"}
              onChange={(e) => {
                setUsername(e.target.value);
                setError(null);
              }}
              placeholder="username"
              className="pl-7"
              autoFocus={mode === "create"}
              maxLength={30}
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="displayName">Display name</Label>
          <Input
            id="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Nike"
            maxLength={80}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Priority</Label>
            <Select value={tier} onValueChange={(v) => setTier(v as Tier)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIERS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {TIER_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Watchlist</Label>
            <Select value={watchlistId} onValueChange={setWatchlistId}>
              <SelectTrigger>
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Unassigned</SelectItem>
                {watchlists.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="notes">Notes</Label>
          <Textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional internal note"
            rows={2}
            maxLength={500}
          />
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2.5">
          <div>
            <div className="text-sm font-medium">Monitoring</div>
            <div className="text-xs text-muted-foreground">
              {monitoring
                ? "Scanner will include this account in each cycle."
                : "Scanner will skip this account until re-enabled."}
            </div>
          </div>
          <Switch checked={monitoring} onCheckedChange={setMonitoring} />
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </DialogClose>
          <Button type="submit" disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />{" "}
                {mode === "create" ? "Adding…" : "Saving…"}
              </>
            ) : mode === "create" ? (
              "Add account"
            ) : (
              "Save changes"
            )}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

// ---------- Scan queue progress panel ----------------------------------------

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m ${String(rs).padStart(2, "0")}s`;
}

function ScanQueuePanel({
  queue,
  onCancel,
  onClose,
}: {
  queue: {
    ids: string[];
    index: number;
    startedAt: number;
    nowTick: number;
    results: Array<{
      id: string;
      username: string;
      status: "pending" | "running" | "ok" | "failed";
      inserted: number;
      error?: string;
    }>;
    cancelled: boolean;
  };
  onCancel: () => void;
  onClose: () => void;
}) {
  const total = queue.ids.length;
  const doneCount = queue.results.filter(
    (r) => r.status === "ok" || r.status === "failed",
  ).length;
  const running = queue.results[queue.index];
  const remaining = Math.max(0, total - doneCount - (running?.status === "running" ? 1 : 0));
  const isFinished = doneCount >= total || queue.cancelled;
  const elapsed = queue.nowTick - queue.startedAt;
  // ETA: only estimate once we have at least one completed run.
  const avgMs = doneCount > 0 ? elapsed / doneCount : 0;
  const remainingForEta = total - doneCount;
  const etaMs = avgMs > 0 ? Math.round(avgMs * remainingForEta) : null;
  const totalInserted = queue.results.reduce((s, r) => s + r.inserted, 0);
  const totalFailed = queue.results.filter((r) => r.status === "failed").length;
  const pct = Math.round((doneCount / total) * 100);

  return (
    <div className="soft-shadow mb-4 overflow-hidden rounded-xl border border-primary/25 bg-card">
      <div className="flex flex-wrap items-center gap-3 border-b border-border/60 bg-primary/5 px-4 py-3">
        <div className="grid h-8 w-8 place-items-center rounded-md bg-primary/15 ring-1 ring-primary/30">
          {isFinished ? (
            <Radar className="h-4 w-4 text-primary" />
          ) : (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold tracking-tight">
            {queue.cancelled
              ? "Queue cancelled"
              : isFinished
                ? "Queue complete"
                : `Scanning @${running?.username ?? "…"}`}
          </div>
          <div className="text-[11px] text-muted-foreground tabular-nums">
            {doneCount}/{total} accounts · {remaining} remaining ·{" "}
            {totalInserted} new asset{totalInserted === 1 ? "" : "s"}
            {totalFailed > 0 ? ` · ${totalFailed} failed` : ""}
          </div>
        </div>
        <div className="hidden sm:flex flex-col items-end text-[11px] text-muted-foreground tabular-nums">
          <span>Elapsed {fmtDuration(elapsed)}</span>
          {!isFinished && (
            <span>
              ETA {etaMs != null ? fmtDuration(etaMs) : "calculating…"}
            </span>
          )}
        </div>
        {isFinished ? (
          <Button size="sm" variant="ghost" onClick={onClose} className="gap-1.5">
            <X className="h-3.5 w-3.5" /> Dismiss
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={onCancel} disabled={queue.cancelled}>
            {queue.cancelled ? "Stopping…" : "Cancel"}
          </Button>
        )}
      </div>

      <div className="px-4 pt-3">
        <Progress value={pct} className="h-1.5" />
      </div>

      <ul className="max-h-56 divide-y divide-border/50 overflow-y-auto px-1 py-1">
        {queue.results.map((r) => (
          <li
            key={r.id}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-1.5 text-xs",
              r.status === "running" && "bg-primary/5",
            )}
          >
            <span className="w-4">
              {r.status === "running" ? (
                <Loader2 className="h-3 w-3 animate-spin text-primary" />
              ) : r.status === "ok" ? (
                <span className="inline-block h-2 w-2 rounded-full bg-success" />
              ) : r.status === "failed" ? (
                <span className="inline-block h-2 w-2 rounded-full bg-destructive" />
              ) : (
                <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/40" />
              )}
            </span>
            <span className="min-w-0 flex-1 truncate font-medium text-foreground/90">
              @{r.username}
            </span>
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {r.status === "ok"
                ? r.inserted > 0
                  ? `+${r.inserted}`
                  : "no new"
                : r.status === "failed"
                  ? r.error ?? "failed"
                  : r.status}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
