import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Loader2,
  MapPin,
  Search,
  Sparkles,
  Star,
  History,
  Radar,
  CheckCircle2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { searchLocationsFn } from "@/lib/locations.functions";
import { useCreateTrackedLocation, useTrackedLocations } from "@/lib/db-queries";

// ---------------------------------------------------------------------------
// Local persistence — recents & favorites
// ---------------------------------------------------------------------------

const RECENTS_KEY = "instascanner:location-recents:v1";
const FAVES_KEY = "instascanner:location-favorites:v1";

type FavoritePlace = {
  location_id: string;
  name: string;
  city: string | null;
  country: string | null;
};

function loadJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

let recents: string[] = loadJSON<string[]>(RECENTS_KEY, []);
let favorites: FavoritePlace[] = loadJSON<FavoritePlace[]>(FAVES_KEY, []);
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
function getRecents() {
  return recents;
}
function getFavorites() {
  return favorites;
}
const emptyRecents: string[] = [];
const emptyFaves: FavoritePlace[] = [];
function useRecents() {
  return useSyncExternalStore(subscribe, getRecents, () => emptyRecents);
}
function useFavorites() {
  return useSyncExternalStore(subscribe, getFavorites, () => emptyFaves);
}
function pushRecent(q: string) {
  const trimmed = q.trim();
  if (!trimmed) return;
  recents = [trimmed, ...recents.filter((r) => r.toLowerCase() !== trimmed.toLowerCase())].slice(0, 8);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(recents));
  }
  emit();
}
function toggleFavorite(place: FavoritePlace) {
  const has = favorites.some((f) => f.location_id === place.location_id);
  favorites = has
    ? favorites.filter((f) => f.location_id !== place.location_id)
    : [place, ...favorites].slice(0, 40);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(FAVES_KEY, JSON.stringify(favorites));
  }
  emit();
}

// ---------------------------------------------------------------------------
// Suggested luxury destinations
// ---------------------------------------------------------------------------

const SUGGESTED = [
  "Soneva Jani",
  "Burj Al Arab",
  "Nammos Mykonos",
  "Marina Bay Sands",
  "Aman Tokyo",
  "Cheval Blanc St-Tropez",
  "Four Seasons Bora Bora",
  "The Brando",
  "Hôtel du Cap-Eden-Roc",
  "Rosewood São Paulo",
  "Monaco",
  "Capri",
];

// ---------------------------------------------------------------------------
// Types (mirrors LocationSearchResult from the server)
// ---------------------------------------------------------------------------

type Place = {
  location_id: string;
  name: string;
  city: string | null;
  country: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  media_count: number | null;
  thumbnail_url: string | null;
};

function formatCount(n: number | null): string | null {
  if (n === null || n === undefined) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M posts`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K posts`;
  return `${n} posts`;
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

export function LocationSearchDialog({ trigger }: { trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [source, setSource] = useState<"provider" | "fallback" | "fuzzy" | "empty" | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tracking, setTracking] = useState<Record<string, boolean>>({});

  const search = useServerFn(searchLocationsFn);
  const createLocation = useCreateTrackedLocation();
  const { data: trackedRows = [] } = useTrackedLocations();
  const trackedIds = useMemo(
    () => new Set(trackedRows.map((r) => r.location_id)),
    [trackedRows],
  );

  const recentQueries = useRecents();
  const favoritePlaces = useFavorites();
  const favoriteIds = useMemo(
    () => new Set(favoritePlaces.map((f) => f.location_id)),
    [favoritePlaces],
  );

  useEffect(() => {
    if (!open) {
      setQuery("");
      setSubmitted("");
      setResults([]);
      setSource(null);
      setError(null);
    }
  }, [open]);

  // Debounced auto-search
  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2) return;
    const handle = setTimeout(() => {
      runSearch(q);
    }, 400);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open]);

  async function runSearch(q: string) {
    setSubmitted(q);
    setLoading(true);
    setError(null);
    try {
      const r = await search({ data: { query: q } });
      setResults(r.results as Place[]);
      setSource(r.source);
      if (r.results.length > 0) pushRecent(q);
    } catch (e) {
      setResults([]);
      setSource(null);
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  function trackPlace(p: Place, opts?: { silent?: boolean }) {
    return new Promise<boolean>((resolve) => {
      if (trackedIds.has(p.location_id) || tracking[p.location_id]) {
        resolve(true);
        return;
      }
      setTracking((s) => ({ ...s, [p.location_id]: true }));
      createLocation.mutate(
        {
          location_id: p.location_id,
          name: [p.name, p.city].filter(Boolean).join(" · ") || p.name,
          status: "active",
          tier: "B",
        } as never,
        {
          onSuccess: () => {
            if (!opts?.silent) toast.success(`Tracking "${p.name}"`);
            setTracking((s) => {
              const n = { ...s };
              delete n[p.location_id];
              return n;
            });
            resolve(true);
          },
          onError: (e: unknown) => {
            const msg = e instanceof Error ? e.message : "Failed";
            if (!opts?.silent) {
              if (/duplicate|unique/i.test(msg)) toast.error("Already tracking this location");
              else toast.error(msg);
            }
            setTracking((s) => {
              const n = { ...s };
              delete n[p.location_id];
              return n;
            });
            resolve(false);
          },
        },
      );
    });
  }

  async function trackAll() {
    const toTrack = results.filter((r) => !trackedIds.has(r.location_id));
    if (toTrack.length === 0) return;
    const t = toast.loading(`Tracking ${toTrack.length} location${toTrack.length === 1 ? "" : "s"}…`);
    let ok = 0;
    for (const p of toTrack) {
      const success = await trackPlace(p, { silent: true });
      if (success) ok++;
    }
    toast.success(`Tracking ${ok} of ${toTrack.length} locations`, { id: t });
  }

  const showEmptyState = !loading && !error && submitted && results.length === 0;
  const showLanding = !submitted && !loading;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border">
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-4 w-4" /> Track a location
          </DialogTitle>
          <DialogDescription>
            Search Instagram locations by name. No IDs required — the system resolves them for you.
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 py-3 border-b border-border">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Soneva Jani, Burj Al Arab, Monaco…"
              className="pl-9 pr-9 h-10"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-accent"
                aria-label="Clear"
              >
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            )}
          </div>
        </div>

        <div className="max-h-[520px] overflow-y-auto">
          {showLanding && (
            <div className="p-5 space-y-5">
              {favoritePlaces.length > 0 && (
                <Section title="Favorites" icon={<Star className="h-3.5 w-3.5" />}>
                  <div className="space-y-1.5">
                    {favoritePlaces.slice(0, 6).map((f) => (
                      <button
                        key={f.location_id}
                        className="w-full flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-card/40 px-3 py-2 text-left hover:bg-accent/50 transition"
                        onClick={() => setQuery(f.name)}
                      >
                        <div>
                          <div className="text-sm font-medium">{f.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {[f.city, f.country].filter(Boolean).join(", ") || "—"}
                          </div>
                        </div>
                        <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    ))}
                  </div>
                </Section>
              )}

              {recentQueries.length > 0 && (
                <Section title="Recent searches" icon={<History className="h-3.5 w-3.5" />}>
                  <div className="flex flex-wrap gap-1.5">
                    {recentQueries.map((r) => (
                      <button
                        key={r}
                        onClick={() => setQuery(r)}
                        className="text-xs px-2.5 py-1.5 rounded-full border border-border/60 bg-card/40 hover:bg-accent transition"
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </Section>
              )}

              <Section title="Suggested luxury destinations" icon={<Sparkles className="h-3.5 w-3.5" />}>
                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTED.map((s) => (
                    <button
                      key={s}
                      onClick={() => setQuery(s)}
                      className="text-xs px-2.5 py-1.5 rounded-full border border-border/60 bg-card/40 hover:bg-accent transition"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </Section>
            </div>
          )}

          {loading && (
            <div className="p-10 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Searching Instagram locations…
            </div>
          )}

          {error && (
            <div className="p-10 text-center text-sm">
              <div className="text-destructive font-medium">Search failed</div>
              <div className="text-xs text-muted-foreground mt-1">{error}</div>
            </div>
          )}

          {showEmptyState && (
            <div className="p-10 text-center space-y-2">
              <Search className="h-6 w-6 mx-auto text-muted-foreground" />
              <div className="text-sm font-medium">No matching Instagram locations</div>
              <div className="text-xs text-muted-foreground">
                Try a broader query (city, landmark, or resort name).
              </div>
            </div>
          )}

          {!loading && results.length > 0 && (
            <div className="p-4 space-y-2">
              <div className="flex items-center justify-between px-1">
                <div className="text-xs text-muted-foreground">
                  {source === "fuzzy" ? (
                    <span>
                      No exact match — showing {results.length} closest suggestion
                      {results.length === 1 ? "" : "s"} for{" "}
                      <span className="text-foreground">"{submitted}"</span>
                    </span>
                  ) : (
                    <>
                      {results.length} result{results.length === 1 ? "" : "s"}
                      {source === "fallback" ? " · public index" : source === "provider" ? " · provider" : ""}
                    </>
                  )}
                </div>
                {results.length > 1 && results.some((r) => !trackedIds.has(r.location_id)) && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={trackAll}>
                    Track all
                  </Button>
                )}
              </div>
              {results.map((p) => {
                const tracked = trackedIds.has(p.location_id);
                const pending = tracking[p.location_id];
                const fav = favoriteIds.has(p.location_id);
                const location = [p.city, p.country].filter(Boolean).join(", ");
                return (
                  <div
                    key={p.location_id}
                    className="flex items-center gap-3 rounded-xl border border-border bg-card/60 p-3 soft-shadow"
                  >
                    <div className="h-14 w-14 rounded-lg overflow-hidden bg-muted flex items-center justify-center shrink-0">
                      {p.thumbnail_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.thumbnail_url}
                          alt=""
                          className="h-full w-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <MapPin className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{p.name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {location || p.address || "—"}
                      </div>
                      <div className="text-[10px] text-muted-foreground/70 font-mono mt-0.5 flex items-center gap-2">
                        <span>ID {p.location_id}</span>
                        {formatCount(p.media_count) && (
                          <>
                            <span>·</span>
                            <span>{formatCount(p.media_count)}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() =>
                        toggleFavorite({
                          location_id: p.location_id,
                          name: p.name,
                          city: p.city,
                          country: p.country,
                        })
                      }
                      className="p-1.5 rounded hover:bg-accent"
                      aria-label={fav ? "Remove favorite" : "Add favorite"}
                    >
                      <Star
                        className={`h-4 w-4 ${fav ? "fill-current text-amber-400" : "text-muted-foreground"}`}
                      />
                    </button>
                    {tracked ? (
                      <Button size="sm" variant="ghost" disabled className="h-8 gap-1.5">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Tracking
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        className="h-8 gap-1.5"
                        onClick={() => trackPlace(p)}
                        disabled={pending}
                      >
                        {pending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Radar className="h-3.5 w-3.5" />
                        )}
                        Track
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}
