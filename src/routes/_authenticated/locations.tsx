import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { MapPin, Plus, Radar, Loader2, Trash2, Pause, Play, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { TierChip } from "@/components/operator-score";
import { scanLocationNowFn } from "@/lib/locations.functions";
import {
  useTrackedLocations,
  useCreateTrackedLocation,
  useUpdateTrackedLocation,
  useDeleteTrackedLocation,
  trackedLocationsKey,
  type TrackedLocation,
} from "@/lib/db-queries";

export const Route = createFileRoute("/_authenticated/locations")({
  head: () => ({ meta: [{ title: "Tracked Locations — InstaScanner" }] }),
  component: LocationsPage,
});

type Tier = "S" | "A" | "B" | "C";
const TIERS: Tier[] = ["S", "A", "B", "C"];
const TIER_LABEL: Record<Tier, string> = {
  S: "S — Mission Critical",
  A: "A — High Priority",
  B: "B — Normal",
  C: "C — Low Priority",
};

const LOCATION_ID_RE = /^\d{3,20}$/;

function timeAgo(iso: string | null) {
  if (!iso) return "—";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

function LocationsPage() {
  const { data: rows = [], isLoading } = useTrackedLocations();
  const createLocation = useCreateTrackedLocation();
  const updateLocation = useUpdateTrackedLocation();
  const deleteLocation = useDeleteTrackedLocation();
  const scanNow = useServerFn(scanLocationNowFn);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [addOpen, setAddOpen] = useState(false);
  const [scanning, setScanning] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [bulkPending, setBulkPending] = useState(false);

  const selectedIds = Object.keys(selected).filter((k) => selected[k]);
  const selectedCount = selectedIds.length;
  const allSelected = rows.length > 0 && selectedCount === rows.length;
  const someSelected = selectedCount > 0 && !allSelected;

  function toggleAll(v: boolean) {
    if (!v) {
      setSelected({});
      return;
    }
    const next: Record<string, boolean> = {};
    for (const r of rows) next[r.id] = true;
    setSelected(next);
  }

  function toggleOne(id: string, v: boolean) {
    setSelected((s) => {
      const next = { ...s };
      if (v) next[id] = true;
      else delete next[id];
      return next;
    });
  }

  async function bulkSetStatus(status: "active" | "paused") {
    if (selectedCount === 0 || bulkPending) return;
    const ids = [...selectedIds];
    const label = status === "paused" ? "Pausing" : "Activating";
    const t = toast.loading(`${label} ${ids.length} location${ids.length === 1 ? "" : "s"}…`);
    setBulkPending(true);
    let ok = 0;
    let failed = 0;
    await Promise.all(
      ids.map(
        (id) =>
          new Promise<void>((resolve) => {
            updateLocation.mutate(
              { id, patch: { status } },
              {
                onSuccess: () => {
                  ok++;
                  resolve();
                },
                onError: () => {
                  failed++;
                  resolve();
                },
              },
            );
          }),
      ),
    );
    setBulkPending(false);
    setSelected({});
    if (failed === 0) {
      toast.success(
        `${status === "paused" ? "Paused" : "Activated"} ${ok} location${ok === 1 ? "" : "s"}`,
        { id: t },
      );
    } else {
      toast.error(`Updated ${ok}, failed ${failed}`, { id: t });
    }
  }

  const [locationId, setLocationId] = useState("");
  const [name, setName] = useState("");
  const [tier, setTier] = useState<Tier>("B");

  function reset() {
    setLocationId("");
    setName("");
    setTier("B");
  }

  function handleCreate() {
    const raw = locationId.trim();
    if (!LOCATION_ID_RE.test(raw)) {
      toast.error("Enter a numeric Instagram location id (3–20 digits)");
      return;
    }
    if (!name.trim()) {
      toast.error("Give the location a display name");
      return;
    }
    createLocation.mutate(
      {
        location_id: raw,
        name: name.trim(),
        tier,
        status: "active",
      } as never,
      {
        onSuccess: (row) => {
          toast.success(`Tracking "${row.name}"`);
          setAddOpen(false);
          reset();
        },
        onError: (e: unknown) => {
          const msg = e instanceof Error ? e.message : "Failed to add location";
          if (/duplicate|unique/i.test(msg)) {
            toast.error("Already tracking this location");
          } else {
            toast.error(msg);
          }
        },
      },
    );
  }

  async function handleScanNow(loc: TrackedLocation) {
    if (scanning[loc.id]) return;
    setScanning((s) => ({ ...s, [loc.id]: true }));
    const t = toast.loading(`Scanning "${loc.name}"…`);
    try {
      const r = await scanNow({ data: { locationRowId: loc.id } });
      qc.invalidateQueries({ queryKey: trackedLocationsKey });
      if (r.status === "failed") {
        toast.error(`Scan failed for "${loc.name}"`, {
          id: t,
          description: r.error ?? "Provider returned an error",
        });
      } else if (r.inserted > 0) {
        toast.success(
          `Found ${r.inserted} new asset${r.inserted === 1 ? "" : "s"} at "${loc.name}"`,
          {
            id: t,
            action: {
              label: "View in Inbox",
              onClick: () =>
                navigate({ to: "/assets", search: { day: "all", status: "all" } }),
            },
          },
        );
      } else {
        toast(`No new assets at "${loc.name}"`, {
          id: t,
          description:
            r.duplicates > 0
              ? `${r.duplicates} already in archive`
              : "Provider returned no posts",
        });
      }
    } catch (err) {
      toast.error(`Scan failed for "${loc.name}"`, {
        id: t,
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setScanning((s) => {
        const next = { ...s };
        delete next[loc.id];
        return next;
      });
    }
  }

  return (
    <div className="p-6 md:p-8 space-y-6">
      <PageHeader
        eyebrow="Location surveillance"
        title="Tracked Locations"
        description={`${rows.length} location${rows.length === 1 ? "" : "s"} under active monitoring. Provider polls each location on the same 6-hour cadence as accounts.`}
        status={{ label: "Monitoring", tone: "success", live: true }}
        actions={
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button className="gap-1.5">
                <Plus className="h-4 w-4" /> Add Location
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Track new location</DialogTitle>
                <DialogDescription>
                  Instagram location IDs are numeric. You can find them in the URL of any location page,
                  e.g. <span className="font-mono">instagram.com/explore/locations/<b>213385402</b>/berghain</span>.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="loc-id">Location ID</Label>
                  <Input
                    id="loc-id"
                    value={locationId}
                    onChange={(e) => setLocationId(e.target.value)}
                    placeholder="213385402"
                    className="font-mono"
                  />
                </div>
                <div>
                  <Label htmlFor="loc-name">Display name</Label>
                  <Input
                    id="loc-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Berghain, Berlin"
                  />
                </div>
                <div>
                  <Label htmlFor="loc-tier">Priority tier</Label>
                  <Select value={tier} onValueChange={(v) => setTier(v as Tier)}>
                    <SelectTrigger id="loc-tier">
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
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="ghost">Cancel</Button>
                </DialogClose>
                <Button onClick={handleCreate} disabled={createLocation.isPending}>
                  {createLocation.isPending ? "Adding…" : "Start monitoring"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="rounded-xl border border-border bg-card soft-shadow overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Loading locations…
          </div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <MapPin className="h-6 w-6 mx-auto text-muted-foreground" />
            <div className="text-sm font-medium">No locations tracked yet</div>
            <div className="text-xs text-muted-foreground">
              Add a numeric Instagram location id to begin autonomous monitoring.
            </div>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Location</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last scan</TableHead>
                <TableHead>Next scan</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((loc) => (
                <TableRow key={loc.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <div className="text-sm font-medium">{loc.name}</div>
                        <div className="text-xs text-muted-foreground font-mono">
                          {loc.location_id}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={loc.tier}
                      onValueChange={(v) =>
                        updateLocation.mutate({ id: loc.id, patch: { tier: v } })
                      }
                    >
                      <SelectTrigger className="w-28 h-8">
                        <TierChip tier={loc.tier as Tier} />
                      </SelectTrigger>
                      <SelectContent>
                        {TIERS.map((t) => (
                          <SelectItem key={t} value={t}>
                            {TIER_LABEL[t]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <button
                      className="text-xs px-2 py-1 rounded border border-border hover:bg-accent capitalize"
                      onClick={() =>
                        updateLocation.mutate({
                          id: loc.id,
                          patch: { status: loc.status === "active" ? "paused" : "active" },
                        })
                      }
                    >
                      {loc.status}
                    </button>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {timeAgo(loc.last_scan_at)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {loc.status === "paused" ? "paused" : timeAgo(loc.next_scan_at).replace("ago", "from now")}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center gap-1 justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5"
                        onClick={() => handleScanNow(loc)}
                        disabled={!!scanning[loc.id]}
                      >
                        {scanning[loc.id] ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Radar className="h-3.5 w-3.5" />
                        )}
                        Scan
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        onClick={() => {
                          if (confirm(`Stop tracking "${loc.name}"?`)) {
                            deleteLocation.mutate(loc.id, {
                              onSuccess: () => toast(`Removed "${loc.name}"`),
                            });
                          }
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
