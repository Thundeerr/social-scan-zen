import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Plus, MoreHorizontal, Search, Loader2, Radar } from "lucide-react";
import { toast } from "sonner";
import { scanAccountNowFn } from "@/lib/scanner.functions";
import { trackedAccountsKey } from "@/lib/db-queries";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
    <div className="p-6 md:p-8">
      <PageHeader
        title="Tracked Accounts"
        description={`${dbRows.length} accounts under active surveillance.`}
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

      <div className="flex flex-wrap items-center gap-2 mb-4">
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
        <div className="ml-auto text-xs text-muted-foreground tabular-nums">
          {filtered.length} results
        </div>
      </div>

      <div className="soft-shadow rounded-xl border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[28%]">Account</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Watchlist</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last Scan</TableHead>
              <TableHead>Next Scan</TableHead>
              <TableHead className="text-right">Total Assets</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((a) => {
              const wl = assignmentMap[a.id]
                ? watchlistNameById[assignmentMap[a.id]]
                : null;
              return (
                <TableRow key={a.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <img
                        src={a.avatar_url || getAvatar(a.username)}
                        alt=""
                        className="h-9 w-9 rounded-full ring-1 ring-border bg-muted"
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">
                          @{a.username}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {a.display_name}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <TierChip tier={a.tier as Tier} size="sm" showLabel />
                  </TableCell>
                  <TableCell>
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
                  <TableCell>
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
                  <TableCell className="text-sm text-muted-foreground">
                    {timeAgo(a.last_scan_at)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {nextScanLabel(a)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {assetCounts[a.id] ?? 0}
                  </TableCell>
                  <TableCell>
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
                  </TableCell>
                </TableRow>
              );
            })}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={8}
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
