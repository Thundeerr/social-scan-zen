import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, MoreHorizontal, Search, Loader2 } from "lucide-react";
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
import { trackedAccounts, getAvatar, type Account } from "@/lib/mock-data";
import { tierFor, TIER_META, TIER_ORDER } from "@/lib/priority";
import { TierChip } from "@/components/operator-score";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/accounts")({
  head: () => ({ meta: [{ title: "Tracked Accounts — InstaScanner" }] }),
  component: AccountsPage,
});

type Category = "brand" | "creator" | "competitor" | "reference";

type Row = Account & {
  category?: Category;
  notes?: string;
  notify?: boolean;
  optimistic?: boolean;
};

const initialRows: Row[] = trackedAccounts.map((a) => ({ ...a }));

function AccountsPage() {
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "paused">("all");
  const [open, setOpen] = useState(false);

  const filtered = rows.filter((a) => {
    if (filter !== "all" && a.status !== filter) return false;
    if (q && !a.username.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  function handleAdd(row: Row) {
    setRows((r) => [row, ...r]);
    // Simulate backend confirmation
    setTimeout(() => {
      setRows((r) =>
        r.map((x) => (x.id === row.id ? { ...x, optimistic: false } : x)),
      );
      toast.success(`@${row.username} is now being monitored`);
    }, 1400);
  }

  function togglePause(id: string) {
    setRows((r) =>
      r.map((x) =>
        x.id === id
          ? { ...x, status: x.status === "active" ? "paused" : "active" }
          : x,
      ),
    );
  }

  function rescan(id: string) {
    setRows((r) =>
      r.map((x) => (x.id === id ? { ...x, lastScan: "just now" } : x)),
    );
    toast("Rescan queued");
  }

  function remove(id: string) {
    const gone = rows.find((x) => x.id === id);
    setRows((r) => r.filter((x) => x.id !== id));
    if (gone) toast(`Removed @${gone.username}`);
  }

  return (
    <div className="p-6 md:p-8">
      <PageHeader
        title="Tracked Accounts"
        description={`${rows.length} accounts under active surveillance.`}
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="gap-1.5">
                <Plus className="h-4 w-4" /> Add Account
              </Button>
            </DialogTrigger>
            <AddAccountDialog
              existing={rows}
              onAdd={(row) => {
                handleAdd(row);
                setOpen(false);
              }}
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
              <TableHead className="w-[36%]">Account</TableHead>
              <TableHead>Tier</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last Scan</TableHead>
              <TableHead className="text-right">Assets Today</TableHead>
              <TableHead>Followers</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((a) => (
              <TableRow
                key={a.id}
                className={cn(a.optimistic && "animate-fade-in bg-primary/[0.03]")}
              >
                <TableCell>
                  <div className="flex items-center gap-3">
                    <img
                      src={getAvatar(a.username)}
                      alt=""
                      className="h-9 w-9 rounded-full ring-1 ring-border"
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">@{a.username}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {a.displayName}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  {a.optimistic ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 text-primary px-2 py-0.5 text-[11px]">
                      <Loader2 className="h-3 w-3 animate-spin" /> syncing
                    </span>
                  ) : (
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
                          a.status === "active" ? "bg-success" : "bg-muted-foreground",
                        )}
                      />
                      {a.status}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{a.lastScan}</TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  {a.assetsToday > 0 ? (
                    <span className="text-primary">{a.assetsToday}</span>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground tabular-nums">
                  {a.followers}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => rescan(a.id)}>
                        Rescan now
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => togglePause(a.id)}>
                        {a.status === "active" ? "Pause" : "Resume"}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={() => remove(a.id)}
                      >
                        Remove
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-24 text-center text-sm text-muted-foreground"
                >
                  No accounts match your filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function AddAccountDialog({
  existing,
  onAdd,
}: {
  existing: Row[];
  onAdd: (row: Row) => void;
}) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [followers, setFollowers] = useState("");
  const [category, setCategory] = useState<Category>("brand");
  const [notify, setNotify] = useState(true);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const cleanUsername = username.trim().replace(/^@/, "").toLowerCase();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!cleanUsername) {
      setError("Username is required");
      return;
    }
    if (!/^[a-z0-9._]{1,30}$/.test(cleanUsername)) {
      setError("Only letters, numbers, dots and underscores");
      return;
    }
    if (existing.some((r) => r.username === cleanUsername)) {
      setError("You are already tracking this account");
      return;
    }

    const row: Row = {
      id: `new-${Date.now()}`,
      username: cleanUsername,
      displayName: displayName.trim() || cleanUsername,
      status: "active",
      lastScan: "queued",
      assetsToday: 0,
      followers: followers.trim() || "—",
      category,
      notify,
      notes: notes.trim() || undefined,
      optimistic: true,
    };
    onAdd(row);
  }

  return (
    <DialogContent className="sm:max-w-[460px]">
      <DialogHeader>
        <DialogTitle>Add Instagram account</DialogTitle>
        <DialogDescription>
          The scanner will begin monitoring this account on the next cycle.
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
              onChange={(e) => {
                setUsername(e.target.value);
                setError(null);
              }}
              placeholder="username"
              className="pl-7"
              autoFocus
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="displayName">Display name</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Nike"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="followers">Followers</Label>
            <Input
              id="followers"
              value={followers}
              onChange={(e) => setFollowers(e.target.value)}
              placeholder="e.g. 12.4M"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Category</Label>
          <Select value={category} onValueChange={(v) => setCategory(v as Category)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="brand">Brand</SelectItem>
              <SelectItem value="creator">Creator</SelectItem>
              <SelectItem value="competitor">Competitor</SelectItem>
              <SelectItem value="reference">Reference</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="notes">Notes</Label>
          <Textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional internal note"
            rows={2}
          />
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2.5">
          <div>
            <div className="text-sm font-medium">Notify on new assets</div>
            <div className="text-xs text-muted-foreground">
              Alert both operators when this account delivers new assets.
            </div>
          </div>
          <Switch checked={notify} onCheckedChange={setNotify} />
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </DialogClose>
          <Button type="submit" disabled={!username.trim()}>
            Add account
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
