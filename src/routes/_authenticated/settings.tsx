import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Send,
  Check,
  X,
  Loader2,
  Radar,
  MapPin,
  RefreshCcw,
  AlertTriangle,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import {
  SCAN_INTERVAL_OPTIONS,
  scanIntervalSchema,
  useScanInterval,
} from "@/lib/scan-interval";
import {
  locationProviderStatusFn,
  testLocationFetchFn,
} from "@/lib/location-diagnostics.functions";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings — InstaScanner" }] }),
  component: SettingsPage,
});

function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 py-5 first:pt-0 last:pb-0 border-b border-border last:border-0">
      <div className="max-w-lg">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
      </div>
      <div className="sm:min-w-[220px] sm:flex sm:justify-end">{children}</div>
    </div>
  );
}

function SettingsPage() {
  const [provider, setProvider] = useState("instagram-looter");
  const [interval, setIntervalValue] = useScanInterval();
  const [desktopNotif, setDesktopNotif] = useState(false);
  const [newOnly, setNewOnly] = useState(true);

  const handleIntervalChange = (next: string) => {
    const parsed = scanIntervalSchema.safeParse(next);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Unsupported scan interval");
      return;
    }
    setIntervalValue(parsed.data);
  };

  return (
    <div className="p-6 md:p-8 space-y-6">
      <PageHeader
        eyebrow="Operator preferences"
        eyebrowTone="muted"
        eyebrowDot={false}
        title="Settings"
        description="Configure scanner behavior, notifications, and appearance."
      />

      <div className="max-w-3xl space-y-6">
        <section className="soft-shadow rounded-xl border border-border bg-card p-6">
          <h2 className="text-sm font-semibold mb-1">Scanner</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Choose the API provider and how often accounts are polled.
          </p>
          <div className="divide-y divide-border">
            <SettingRow
              title="API Provider"
              description="Backend service used to fetch Instagram data."
            >
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger className="w-full sm:w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="instagram-looter">Instagram Looter</SelectItem>
                  <SelectItem value="rapidapi">RapidAPI</SelectItem>
                  <SelectItem value="custom">Custom Endpoint</SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>
            <SettingRow
              title="Scan Interval"
              description="How frequently the scanner cycles through all tracked accounts."
            >
              <Select value={interval} onValueChange={handleIntervalChange}>
                <SelectTrigger className="w-full sm:w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCAN_INTERVAL_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingRow>
          </div>
        </section>

        <section className="soft-shadow rounded-xl border border-border bg-card p-6">
          <h2 className="text-sm font-semibold mb-1">Notifications</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Choose how you're alerted when new assets are detected.
          </p>
          <div className="divide-y divide-border">
            <SettingRow
              title="Telegram bot"
              description="Manage Telegram delivery from the dedicated Telegram section."
            >
              <Button asChild variant="outline" size="sm" className="h-9 gap-1.5">
                <Link to="/telegram">
                  <Send className="h-3.5 w-3.5" />
                  Open Telegram
                </Link>
              </Button>
            </SettingRow>
            <SettingRow title="Desktop notifications" description="Show a native notification when scans complete.">
              <Switch checked={desktopNotif} onCheckedChange={setDesktopNotif} />
            </SettingRow>
            <SettingRow title="New assets only" description="Suppress notifications for empty scans.">
              <Switch checked={newOnly} onCheckedChange={setNewOnly} />
            </SettingRow>
          </div>
        </section>

        <LocationProviderSection />



        <section className="soft-shadow rounded-xl border border-border bg-card p-6">
          <h2 className="text-sm font-semibold mb-1">Appearance</h2>
          <p className="text-xs text-muted-foreground mb-4">
            InstaScanner is designed for extended late-night review sessions.
          </p>
          <div className="divide-y divide-border">
            <SettingRow title="Dark Mode" description="Dark mode is enforced by design.">
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground">Locked on</Label>
                <Switch checked disabled />
              </div>
            </SettingRow>
          </div>
        </section>
      </div>
    </div>
  );
}

// -------------------- Location provider diagnostics --------------------

type StatusPayload = Awaited<ReturnType<typeof locationProviderStatusFn>>;
type TestPayload = Awaited<ReturnType<typeof testLocationFetchFn>>;

function StatusChip({ set, label }: { set: boolean; label: string }) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium",
        set
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
          : "border-border bg-muted/30 text-muted-foreground",
      )}
    >
      {set ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
      <span className="font-mono">{label}</span>
      <span className="opacity-70">{set ? "set" : "default"}</span>
    </div>
  );
}

const SAMPLE_LOCATIONS: { id: string; name: string }[] = [
  { id: "213385402", name: "Berghain, Berlin" },
  { id: "110536485641386", name: "Sisyphos, Berlin" },
  { id: "212988663", name: "Watergate, Berlin" },
  { id: "6889842", name: "Times Square, NYC" },
  { id: "6002986", name: "Eiffel Tower, Paris" },
  { id: "212790535", name: "Shibuya Crossing, Tokyo" },
];

function LocationProviderSection() {
  const loadStatus = useServerFn(locationProviderStatusFn);
  const runTest = useServerFn(testLocationFetchFn);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [locationId, setLocationId] = useState("213385402"); // Berghain — public reference
  const [testing, setTesting] = useState(false);
  const testingRef = useRef(false);
  const [testResult, setTestResult] = useState<TestPayload | null>(null);

  async function refreshStatus() {
    setStatusLoading(true);
    setStatusError(null);
    try {
      const res = await loadStatus();
      setStatus(res);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : String(err));
    } finally {
      setStatusLoading(false);
    }
  }

  useEffect(() => {
    void refreshStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onTest() {
    if (testingRef.current) return;
    if (!/^\d{3,20}$/.test(locationId.trim())) {
      toast.error("Enter a numeric Instagram location id (3–20 digits)");
      return;
    }
    testingRef.current = true;
    setTesting(true);
    setTestResult(null);
    const t = toast.loading("Contacting provider…");
    try {
      const res = await runTest({ data: { locationId: locationId.trim() } });
      setTestResult(res);
      if (res.ok) {
        toast.success(
          `Provider returned ${res.postCount} post${res.postCount === 1 ? "" : "s"} in ${res.elapsedMs} ms`,
          { id: t },
        );
      } else {
        toast.error("Provider test failed", { id: t, description: res.error });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTestResult({ ok: false, elapsedMs: 0, error: msg });
      toast.error("Provider test failed", { id: t, description: msg });
    } finally {
      testingRef.current = false;
      setTesting(false);
    }
  }

  return (
    <section className="soft-shadow rounded-xl border border-border bg-card p-6">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-sm font-semibold mb-1 flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 text-primary" />
            Location provider
          </h2>
          <p className="text-xs text-muted-foreground">
            RapidAPI configuration used by location scans. Missing values fall
            back to the <span className="font-mono">instagram-looter2</span>{" "}
            convention.
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 gap-1.5"
          onClick={() => void refreshStatus()}
          disabled={statusLoading}
        >
          {statusLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCcw className="h-3.5 w-3.5" />
          )}
          Refresh
        </Button>
      </div>

      {statusError ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <div>Could not read provider status: {statusError}</div>
        </div>
      ) : statusLoading || !status ? (
        <div className="text-xs text-muted-foreground">Reading env…</div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <StatusChip set={status.pathSet} label="RAPIDAPI_LOCATION_PATH" />
            <StatusChip set={status.idParamSet} label="RAPIDAPI_LOCATION_ID_PARAM" />
            <StatusChip set={status.extraSet} label="RAPIDAPI_LOCATION_EXTRA_PARAMS" />
          </div>
          <div className="rounded-md border border-border bg-muted/20 p-3 text-[11px] space-y-1 font-mono text-muted-foreground">
            <div>
              <span className="text-foreground">host:</span>{" "}
              {status.host ?? <span className="text-destructive">missing RAPIDAPI_HOST</span>}
            </div>
            <div>
              <span className="text-foreground">key:</span>{" "}
              {status.keySet ? (
                "configured"
              ) : (
                <span className="text-destructive">missing RAPIDAPI_KEY</span>
              )}
            </div>
            <div>
              <span className="text-foreground">effective path:</span>{" "}
              {status.effectivePath}{" "}
              {!status.pathSet && <span className="opacity-60">(default)</span>}
            </div>
            <div>
              <span className="text-foreground">id param:</span>{" "}
              {status.effectiveIdParam}{" "}
              {!status.idParamSet && (
                <span className="opacity-60">(default)</span>
              )}
            </div>
            {status.extraKeys.length > 0 && (
              <div>
                <span className="text-foreground">extra keys:</span>{" "}
                {status.extraKeys.join(", ")}
              </div>
            )}
            {status.exampleUrl && (
              <div className="pt-1 break-all">
                <span className="text-foreground">example:</span>{" "}
                {status.exampleUrl}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mt-5 border-t border-border pt-5">
        <div className="flex items-center gap-1.5 mb-1">
          <Radar className="h-3.5 w-3.5 text-primary" />
          <div className="text-sm font-medium">Location fetch test</div>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Dry-run — hits the provider once and shows what came back. Nothing is
          written to the archive.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            placeholder="213385402"
            className="font-mono sm:max-w-xs"
            disabled={testing}
            aria-busy={testing}
          />
          <Button
            onClick={() => void onTest()}
            disabled={testing || !status?.host || !status?.keySet}
            aria-busy={testing}
            className="gap-1.5"
          >
            {testing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Radar className="h-3.5 w-3.5" />
            )}
            {testing ? "Running…" : "Run test fetch"}
          </Button>
        </div>

        <div className="mt-3">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">
            Sample locations
          </div>
          <div className="flex flex-wrap gap-1.5">
            {SAMPLE_LOCATIONS.map((s) => {
              const active = locationId.trim() === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setLocationId(s.id)}
                  disabled={testing}
                  className={`text-xs px-2 py-1 rounded border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    active
                      ? "border-primary/50 bg-primary/10 text-foreground"
                      : "border-border hover:bg-accent text-muted-foreground hover:text-foreground"
                  }`}
                  title={`${s.name} — ${s.id}`}
                >
                  <span className="font-medium">{s.name}</span>
                  <span className="ml-1.5 font-mono text-[10px] opacity-60">
                    {s.id}
                  </span>
                </button>
              );
            })}
          </div>
        </div>


        {testResult && testResult.ok && (
          <div className="mt-4 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-semibold tabular-nums text-emerald-300 leading-none">
                    {testResult.postCount}
                  </span>
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    asset{testResult.postCount === 1 ? "" : "s"} found
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-emerald-300">
                <Check className="h-3.5 w-3.5" />
                <span className="font-medium">{testResult.elapsedMs} ms</span>
              </div>
            </div>
            <div className="text-muted-foreground">
              <span className="text-foreground">Location:</span>{" "}
              {testResult.name ?? <span className="italic">unnamed</span>}{" "}
              <span className="font-mono">({testResult.locationId})</span>
            </div>

            {testResult.previewPosts && testResult.previewPosts.length > 0 && (
              <div className="space-y-1.5 pt-1">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Preview · first {testResult.previewPosts.length} of {testResult.postCount}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {testResult.previewPosts.map((p) => (
                    <a
                      key={p.external_id}
                      href={p.source_url ?? undefined}
                      target="_blank"
                      rel="noreferrer"
                      className="group flex gap-2 rounded-md border border-border bg-background/40 p-2 hover:border-primary/50 hover:bg-primary/5 transition-colors"
                    >
                      {p.thumbnail_url ? (
                        <img
                          src={p.thumbnail_url}
                          alt=""
                          className="h-14 w-14 rounded border border-border object-cover shrink-0"
                          loading="lazy"
                        />
                      ) : (
                        <div className="h-14 w-14 rounded border border-border bg-muted/30 shrink-0" />
                      )}
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          {p.media_type}
                        </div>
                        {p.caption && (
                          <div className="text-[11px] text-foreground line-clamp-2 leading-tight">
                            {p.caption}
                          </div>
                        )}
                        <div className="text-[10px] text-muted-foreground tabular-nums">
                          {p.likes.toLocaleString()} ♥ · {p.comments.toLocaleString()} 💬
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {(!testResult.previewPosts || testResult.previewPosts.length === 0) && (
              <div className="text-muted-foreground italic">
                Provider returned no posts for this location.
              </div>
            )}
            {!testResult.firstPost && testResult.rawShape && (
              <div className="mt-2 rounded-md border border-border bg-muted/20 p-2 space-y-1.5 text-[11px]">
                <div className="text-muted-foreground uppercase tracking-wider text-[10px]">
                  Response shape (diagnostic)
                </div>
                {testResult.rawShape.topLevelKeys.length > 0 && (
                  <div>
                    <span className="text-muted-foreground">Top-level keys:</span>{" "}
                    <span className="font-mono">
                      {testResult.rawShape.topLevelKeys.join(", ")}
                    </span>
                  </div>
                )}
                {testResult.rawShape.firstArrayPath && (
                  <div>
                    <span className="text-muted-foreground">First array:</span>{" "}
                    <span className="font-mono">
                      {testResult.rawShape.firstArrayPath}
                    </span>{" "}
                    <span className="text-muted-foreground">
                      ({testResult.rawShape.firstArrayLength} items)
                    </span>
                  </div>
                )}
                {testResult.rawShape.preview && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                      Raw preview (first 400 chars)
                    </summary>
                    <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-[10px] opacity-80">
                      {testResult.rawShape.preview}
                    </pre>
                  </details>
                )}
              </div>
            )}
          </div>
        )}


        {testResult && !testResult.ok && (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">Test failed after {testResult.elapsedMs} ms</div>
              <div className="mt-0.5 break-all font-mono text-[11px] opacity-90">
                {testResult.error}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

