import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Play, RefreshCw, Zap, Trash2, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/monitor/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { parseUsernameInput } from "@/lib/monitor/usernames";
import {
  checkAccountNowFn,
  getMonitorSystemStatusFn,
  retryActionFn,
  runSchedulerNowFn,
  triggerManualEventFn,
} from "@/lib/monitor.functions";

export const Route = createFileRoute("/_authenticated/monitor/")({
  head: () => ({
    meta: [
      { title: "Private→Public Monitor — InstaScanner" },
      {
        name: "description",
        content:
          "Autonomous watch on private Instagram accounts: the network detects the moment a profile turns public and dispatches your configured actions.",
      },
      { property: "og:title", content: "Private→Public Monitor — InstaScanner" },
      {
        property: "og:description",
        content:
          "Autonomous watch on private Instagram accounts with deduplicated transition events and traceable order dispatch.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MonitorPage,
});

function fmt(ts: string | null | undefined) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

function Card({
  title,
  description,
  children,
  actions,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="soft-shadow rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-medium">{title}</h2>
          {description && (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        {actions}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function MonitorPage() {
  const qc = useQueryClient();
  const checkNow = useServerFn(checkAccountNowFn);
  const manualEvent = useServerFn(triggerManualEventFn);
  const retryAction = useServerFn(retryActionFn);
  const runScheduler = useServerFn(runSchedulerNowFn);
  const systemStatus = useServerFn(getMonitorSystemStatusFn);

  const statusQuery = useQuery({
    queryKey: ["monitor-system-status"],
    queryFn: () => systemStatus(),
    staleTime: 60_000,
  });

  const accountsQuery = useQuery({
    queryKey: ["monitor-accounts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("monitor_accounts")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const settingsQuery = useQuery({
    queryKey: ["monitor-settings"],
    queryFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      const uid = user.user?.id;
      if (!uid) return null;
      const { data } = await supabase
        .from("monitor_settings")
        .select("*")
        .eq("user_id", uid)
        .maybeSingle();
      if (data) return data;
      const { data: created } = await supabase
        .from("monitor_settings")
        .insert({ user_id: uid })
        .select("*")
        .maybeSingle();
      return created ?? null;
    },
  });

  const activityQuery = useQuery({
    queryKey: ["monitor-activity"],
    queryFn: async () => {
      const [events, actions] = await Promise.all([
        supabase
          .from("monitor_events")
          .select("*, monitor_accounts(username)")
          .order("detected_at", { ascending: false })
          .limit(25),
        supabase
          .from("monitor_actions")
          .select("*, monitor_accounts(username)")
          .order("created_at", { ascending: false })
          .limit(25),
      ]);
      return { events: events.data ?? [], actions: actions.data ?? [] };
    },
  });

  const runsQuery = useQuery({
    queryKey: ["monitor-runs"],
    queryFn: async () => {
      const { data } = await supabase
        .from("monitor_scheduler_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(10);
      return data ?? [];
    },
  });

  // Realtime: the network keeps working while the operator watches.
  useEffect(() => {
    const channel = supabase
      .channel("monitor-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "monitor_accounts" }, () => {
        void qc.invalidateQueries({ queryKey: ["monitor-accounts"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "monitor_events" }, () => {
        void qc.invalidateQueries({ queryKey: ["monitor-activity"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "monitor_actions" }, () => {
        void qc.invalidateQueries({ queryKey: ["monitor-activity"] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);

  const invalidateAll = () => {
    void qc.invalidateQueries({ queryKey: ["monitor-accounts"] });
    void qc.invalidateQueries({ queryKey: ["monitor-activity"] });
    void qc.invalidateQueries({ queryKey: ["monitor-runs"] });
  };

  // ---- Bulk import ----
  const [importText, setImportText] = useState("");
  const parsed = useMemo(() => parseUsernameInput(importText), [importText]);

  const importMutation = useMutation({
    mutationFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      const uid = user.user?.id;
      if (!uid) throw new Error("Not signed in");
      const rows = parsed.valid.map((v) => ({
        user_id: uid,
        username: v.username,
        normalized_username: v.normalized,
      }));
      if (rows.length === 0) throw new Error("Nothing to import");
      const { data, error } = await supabase
        .from("monitor_accounts")
        .upsert(rows, { onConflict: "user_id,normalized_username", ignoreDuplicates: true })
        .select("id");
      if (error) throw error;
      return data?.length ?? 0;
    },
    onSuccess: (count) => {
      setImportText("");
      toast.success(`${count} account${count === 1 ? "" : "s"} added to the watch`);
      invalidateAll();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Import failed"),
  });

  const checkMutation = useMutation({
    mutationFn: (accountId: string) => checkNow({ data: { accountId } }),
    onSuccess: (res) => {
      if (!res.ok) toast.error(res.error ?? "Check failed");
      else if (res.eventCreated) toast.success("Transition detected — actions dispatched");
      else toast.success(`Checked — profile is ${res.result}`);
      invalidateAll();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Check failed"),
  });

  const eventMutation = useMutation({
    mutationFn: (accountId: string) => manualEvent({ data: { accountId } }),
    onSuccess: (res) => {
      toast.success(`Manual event created — ${res.actionsCreated} action(s)`);
      invalidateAll();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Event failed"),
  });

  const retryMutation = useMutation({
    mutationFn: (actionId: string) => retryAction({ data: { actionId } }),
    onSuccess: (res) => {
      toast[res.ok ? "success" : "error"](res.message ?? `Action ${res.status}`);
      invalidateAll();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Retry failed"),
  });

  const schedulerMutation = useMutation({
    mutationFn: () => runScheduler(),
    onSuccess: (res) => {
      toast.success(
        `Run ${res.status} — ${res.checkedAccounts} checked, ${res.createdEvents} events, ${res.createdActions} actions`,
      );
      invalidateAll();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Scheduler failed"),
  });

  const toggleEnabled = async (id: string, enabled: boolean) => {
    await supabase.from("monitor_accounts").update({ enabled }).eq("id", id);
    void qc.invalidateQueries({ queryKey: ["monitor-accounts"] });
  };

  const removeAccount = async (id: string) => {
    await supabase.from("monitor_accounts").delete().eq("id", id);
    void qc.invalidateQueries({ queryKey: ["monitor-accounts"] });
  };

  // ---- Settings ----
  const settings = settingsQuery.data;
  const [draft, setDraft] = useState<{
    default_interval_minutes: number;
    cooldown_minutes: number;
    automation_enabled: boolean;
    batch_size: number;
    adapter_base_url: string;
    adapter_service_reference: string;
    adapter_default_quantity: string;
  } | null>(null);

  useEffect(() => {
    if (!settings) return;
    setDraft({
      default_interval_minutes: settings.default_interval_minutes,
      cooldown_minutes: settings.cooldown_minutes,
      automation_enabled: settings.automation_enabled,
      batch_size: settings.batch_size,
      adapter_base_url: settings.adapter_base_url ?? "",
      adapter_service_reference: settings.adapter_service_reference ?? "",
      adapter_default_quantity:
        settings.adapter_default_quantity == null ? "" : String(settings.adapter_default_quantity),
    });
  }, [settings]);

  const saveSettings = useMutation({
    mutationFn: async () => {
      if (!draft || !settings) throw new Error("Settings not loaded");
      const { error } = await supabase
        .from("monitor_settings")
        .update({
          default_interval_minutes: draft.default_interval_minutes,
          cooldown_minutes: draft.cooldown_minutes,
          automation_enabled: draft.automation_enabled,
          batch_size: draft.batch_size,
          adapter_base_url: draft.adapter_base_url || "https://justanotherpanel.com/api/v2",
          adapter_service_reference: draft.adapter_service_reference || null,
          adapter_default_quantity: draft.adapter_default_quantity
            ? Number(draft.adapter_default_quantity)
            : null,
          adapter_configured_at: new Date().toISOString(),
        })
        .eq("user_id", settings.user_id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Monitor settings saved");
      void qc.invalidateQueries({ queryKey: ["monitor-settings"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  const accounts = accountsQuery.data ?? [];
  const adapterLive = statusQuery.data?.actionAdapterConfigured;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Private→Public Monitor"
        eyebrowTone={settings?.automation_enabled === false ? "warning" : "success"}
        title="Transition Watch"
        description="The network polls every monitored profile on its own cadence and reacts the moment a private account turns public."
        status={{
          label: settings?.automation_enabled === false ? "paused" : "monitoring",
          tone: settings?.automation_enabled === false ? "warning" : "success",
          live: settings?.automation_enabled !== false,
        }}
        actions={
          <Button
            size="sm"
            onClick={() => schedulerMutation.mutate()}
            disabled={schedulerMutation.isPending}
          >
            {schedulerMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            Run scheduler now
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Status source", ok: statusQuery.data?.statusSourceConfigured },
          { label: "Cron secret", ok: statusQuery.data?.cronSecretConfigured },
          { label: "Order adapter", ok: adapterLive },
        ].map((s) => (
          <div
            key={s.label}
            className="soft-shadow flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3"
          >
            <span className="text-xs text-muted-foreground">{s.label}</span>
            <StatusPill
              kind={s.ok ? "completed" : "not_configured"}
              label={s.ok ? "live" : "not configured"}
            />
          </div>
        ))}
      </div>

      <Card
        title="Monitored accounts"
        description={`${accounts.length} profile${accounts.length === 1 ? "" : "s"} under watch`}
        actions={
          <Button size="sm" variant="secondary" onClick={invalidateAll}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        }
      >
        {accountsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading watch list…</p>
        ) : accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Standby — no profiles under watch yet. Import a list below to arm the monitor.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Account</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Interval</th>
                  <th className="py-2 pr-3 font-medium">Last check</th>
                  <th className="py-2 pr-3 font-medium">Next check</th>
                  <th className="py-2 pr-3 font-medium">Last failure</th>
                  <th className="py-2 pr-3 font-medium">Enabled</th>
                  <th className="py-2 pr-3 font-medium text-right">Actions</th>
                </tr>
              </thead>

              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id} className="border-t border-border/60 align-middle">
                    <td className="py-2.5 pr-3">
                      <Link
                        to="/monitor/$accountId"
                        params={{ accountId: a.id }}
                        className="font-medium hover:text-primary"
                      >
                        @{a.username}
                      </Link>
                      {a.last_error && (
                        <div className="mt-0.5 max-w-xs truncate text-[11px] text-destructive">
                          {a.last_error}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">
                      <StatusPill
                        kind={
                          a.is_private === null ? "unknown" : a.is_private ? "private" : "public"
                        }
                      />
                    </td>
                    <td className="py-2.5 pr-3 text-xs text-muted-foreground">
                      {fmt(a.last_checked_at)}
                    </td>
                    <td className="py-2.5 pr-3 text-xs text-muted-foreground">
                      {fmt(a.next_check_at)}
                    </td>
                    <td className="py-2.5 pr-3">
                      <Switch
                        checked={a.enabled}
                        onCheckedChange={(v) => void toggleEnabled(a.id, v)}
                      />
                    </td>
                    <td className="py-2.5 pr-0">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => checkMutation.mutate(a.id)}
                          disabled={checkMutation.isPending}
                        >
                          <RefreshCw className="h-3.5 w-3.5" /> Check
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => eventMutation.mutate(a.id)}
                          disabled={eventMutation.isPending}
                        >
                          <Zap className="h-3.5 w-3.5" /> Event
                        </Button>
                        <Button size="sm" variant="ghost" asChild>
                          <Link to="/monitor/$accountId" params={{ accountId: a.id }}>
                            <ChevronRight className="h-4 w-4" />
                          </Link>
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => void removeAccount(a.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="Bulk import"
        description="Paste usernames, @handles or profile URLs — separated by lines, commas or spaces. # starts a comment."
      >
        <Textarea
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          rows={5}
          placeholder={"@example\nhttps://instagram.com/another\nthird.account  # note"}
          className="font-mono text-xs"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="text-success">{parsed.valid.length} valid</span>
          <span className="text-destructive">{parsed.invalid.length} invalid</span>
          <span className="text-warning">{parsed.duplicates.length} duplicates</span>
          <div className="flex-1" />
          <Button
            size="sm"
            onClick={() => importMutation.mutate()}
            disabled={parsed.valid.length === 0 || importMutation.isPending}
          >
            {importMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Add {parsed.valid.length || ""} to watch
          </Button>
        </div>
        {parsed.invalid.length > 0 && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Rejected: {parsed.invalid.slice(0, 12).join(", ")}
          </p>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Recent transitions" description="Deduplicated private→public events">
          {(activityQuery.data?.events.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">Network active — no transitions yet.</p>
          ) : (
            <ul className="space-y-2">
              {activityQuery.data!.events.map((e: Record<string, any>) => (
                <li
                  key={e.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium">
                      @{e.monitor_accounts?.username ?? "unknown"}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {fmt(e.detected_at)} · {e.trigger_type}
                    </div>
                  </div>
                  <StatusPill
                    kind={e.cooldown_suppressed ? "not_configured" : "completed"}
                    label={e.cooldown_suppressed ? "cooldown" : "fired"}
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Dispatched actions" description="Every order attempt, with its outcome">
          {(activityQuery.data?.actions.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No actions dispatched yet.</p>
          ) : (
            <ul className="space-y-2">
              {activityQuery.data!.actions.map((a: Record<string, any>) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      @{a.monitor_accounts?.username ?? "unknown"} · ×{a.quantity ?? "—"}
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {a.provider_reference
                        ? `order ${a.provider_reference}`
                        : (a.error_message ?? a.target)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill kind={a.status} />
                    {["failed", "not_configured", "unknown_outcome"].includes(a.status) && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => retryMutation.mutate(a.id)}
                        disabled={retryMutation.isPending}
                      >
                        Retry
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Scheduler runs" description="Autonomous cycle history">
        {(runsQuery.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">No cycles recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Started</th>
                  <th className="py-2 pr-3 font-medium">Checked</th>
                  <th className="py-2 pr-3 font-medium">Events</th>
                  <th className="py-2 pr-3 font-medium">Actions</th>
                  <th className="py-2 pr-3 font-medium">Errors</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {runsQuery.data!.map((r) => (
                  <tr key={r.id} className="border-t border-border/60">
                    <td className="py-2 pr-3 text-xs text-muted-foreground">{fmt(r.started_at)}</td>
                    <td className="py-2 pr-3">{r.checked_accounts}</td>
                    <td className="py-2 pr-3">{r.created_events}</td>
                    <td className="py-2 pr-3">{r.created_actions}</td>
                    <td className="py-2 pr-3">{r.errors}</td>
                    <td className="py-2 pr-3">
                      <StatusPill kind={r.status} label={r.status.replace(/_/g, " ")} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="Monitor settings"
        description="Cadence, cooldown and the order-adapter configuration"
        actions={
          <Button
            size="sm"
            onClick={() => saveSettings.mutate()}
            disabled={!draft || saveSettings.isPending}
          >
            {saveSettings.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save
          </Button>
        }
      >
        {!draft ? (
          <p className="text-sm text-muted-foreground">Loading settings…</p>
        ) : (
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium">Automation</div>
                <div className="text-xs text-muted-foreground">
                  Global pause switch — manual checks still work while paused.
                </div>
              </div>
              <Switch
                checked={draft.automation_enabled}
                onCheckedChange={(v) => setDraft({ ...draft, automation_enabled: v })}
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Default check interval</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {(draft.default_interval_minutes / 60).toFixed(1)} h
                </span>
              </div>
              <Slider
                className="mt-3"
                min={180}
                max={2880}
                step={30}
                value={[draft.default_interval_minutes]}
                onValueChange={([v]) => setDraft({ ...draft, default_interval_minutes: v })}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="font-medium">Cooldown (minutes)</span>
                <Input
                  className="mt-1.5"
                  type="number"
                  min={1}
                  value={draft.cooldown_minutes}
                  onChange={(e) =>
                    setDraft({ ...draft, cooldown_minutes: Number(e.target.value) || 1 })
                  }
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium">Batch size</span>
                <Input
                  className="mt-1.5"
                  type="number"
                  min={1}
                  max={50}
                  value={draft.batch_size}
                  onChange={(e) => setDraft({ ...draft, batch_size: Number(e.target.value) || 1 })}
                />
              </label>
            </div>

            <div className="rounded-lg border border-border/60 p-3">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-medium">Order adapter</span>
                <StatusPill
                  kind={adapterLive ? "completed" : "not_configured"}
                  label={adapterLive ? "live" : "not configured"}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block text-sm sm:col-span-3">
                  <span className="text-xs text-muted-foreground">Base URL</span>
                  <Input
                    className="mt-1.5 font-mono text-xs"
                    value={draft.adapter_base_url}
                    onChange={(e) => setDraft({ ...draft, adapter_base_url: e.target.value })}
                  />
                </label>
                <label className="block text-sm sm:col-span-2">
                  <span className="text-xs text-muted-foreground">Default service reference</span>
                  <Input
                    className="mt-1.5"
                    value={draft.adapter_service_reference}
                    onChange={(e) =>
                      setDraft({ ...draft, adapter_service_reference: e.target.value })
                    }
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-xs text-muted-foreground">Default quantity</span>
                  <Input
                    className="mt-1.5"
                    type="number"
                    min={1}
                    value={draft.adapter_default_quantity}
                    onChange={(e) =>
                      setDraft({ ...draft, adapter_default_quantity: e.target.value })
                    }
                  />
                </label>
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
