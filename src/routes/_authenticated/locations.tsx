import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { MapPin, Radar, Loader2, Trash2, Pause, Play, X, Search } from "lucide-react";
import { LocationSearchDialog } from "@/components/location-search-dialog";
import { LocationNameLink } from "@/components/location-name-link";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";


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
  
  const updateLocation = useUpdateTrackedLocation();
  const deleteLocation = useDeleteTrackedLocation();
  const scanNow = useServerFn(scanLocationNowFn);
  const navigate = useNavigate();
  const qc = useQueryClient();

  
  const [scanning, setScanning] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [bulkPending, setBulkPending] = useState(false);

  // Derive selection strictly from current rows so stale IDs (from deleted
  // rows) never leave the header checkbox in a wedged state.
  const rowIds = rows.map((r) => r.id);
  const selectedIds = rowIds.filter((id) => selected[id]);
  const selectedCount = selectedIds.length;
  const allSelected = rows.length > 0 && selectedCount === rows.length;
  const someSelected = selectedCount > 0 && !allSelected;
  const headerState: boolean | "indeterminate" = allSelected
    ? true
    : someSelected
      ? "indeterminate"
      : false;

  function toggleAll(next: boolean | "indeterminate") {
    // Any click while some or all are selected clears; otherwise select all.
    if (next === false || selectedCount > 0) {
      setSelected({});
      return;
    }
    const map: Record<string, boolean> = {};
    for (const id of rowIds) map[id] = true;
    setSelected(map);
  }

  function toggleOne(id: string, v: boolean | "indeterminate") {
    setSelected((s) => {
      const next = { ...s };
      if (v === true) next[id] = true;
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
          <LocationSearchDialog
            trigger={
              <Button className="gap-1.5">
                <Search className="h-4 w-4" /> Track Location
              </Button>
            }
          />
        }
      />

      {selectedCount > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-2.5 soft-shadow">
          <div className="text-sm">
            <span className="font-medium">{selectedCount}</span>{" "}
            <span className="text-muted-foreground">
              selected of {rows.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5"
              onClick={() => bulkSetStatus("active")}
              disabled={bulkPending}
            >
              <Play className="h-3.5 w-3.5" /> Activate
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5"
              onClick={() => bulkSetStatus("paused")}
              disabled={bulkPending}
            >
              <Pause className="h-3.5 w-3.5" /> Pause
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 gap-1.5"
              onClick={() => setSelected({})}
              disabled={bulkPending}
            >
              <X className="h-3.5 w-3.5" /> Clear
            </Button>
          </div>
        </div>
      )}

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
                <TableHead className="w-10">
                  <Checkbox
                    checked={headerState}
                    onCheckedChange={(v) => toggleAll(v)}
                    aria-label={
                      allSelected
                        ? "Deselect all locations"
                        : someSelected
                          ? `Clear ${selectedCount} selected`
                          : "Select all locations"
                    }
                  />
                </TableHead>
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
                <TableRow key={loc.id} data-state={selected[loc.id] ? "selected" : undefined}>
                  <TableCell className="w-10">
                    <Checkbox
                      checked={!!selected[loc.id]}
                      onCheckedChange={(v) => toggleOne(loc.id, v)}
                      aria-label={`Select ${loc.name}`}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <LocationNameLink
                          locationId={loc.location_id}
                          name={loc.name}
                        />
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
