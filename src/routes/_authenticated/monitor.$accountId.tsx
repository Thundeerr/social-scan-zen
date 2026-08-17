import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Plus, RefreshCw, Trash2, Zap, Eye, Rocket } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/monitor/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ServicePicker, type ProviderService } from "@/components/monitor/service-picker";
import {
  checkAccountNowFn,
  previewTestOrderFn,
  retryActionFn,
  triggerManualEventFn,
  triggerTestOrderFn,
} from "@/lib/monitor.functions";


export const Route = createFileRoute("/_authenticated/monitor/$accountId")({
  head: () => ({
    meta: [
      { title: "Monitored profile — InstaScanner" },
      {
        name: "description",
        content:
          "Full check history, transition events and dispatched actions for a single monitored Instagram profile.",
      },
      { property: "og:title", content: "Monitored profile — InstaScanner" },
      {
        property: "og:description",
        content: "Check history, transition events and order dispatch log for one monitored profile.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AccountDetail,
});

function fmt(ts: string | null | undefined) {
  return ts ? new Date(ts).toLocaleString() : "—";
}

function Card({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="soft-shadow rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-medium">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

const EMPTY_TEMPLATE = {
  name: "",
  service_reference: "",
  quantity: "1",
  target_template: "https://instagram.com/{username}",
  position: "0",
  dry_run: false,
};

function AccountDetail() {
  const { accountId } = useParams({ from: "/_authenticated/monitor/$accountId" });
  const qc = useQueryClient();
  const checkNow = useServerFn(checkAccountNowFn);
  const manualEvent = useServerFn(triggerManualEventFn);
  const retryAction = useServerFn(retryActionFn);

  const accountQuery = useQuery({
    queryKey: ["monitor-account", accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("monitor_accounts")
        .select("*")
        .eq("id", accountId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const templatesQuery = useQuery({
    queryKey: ["monitor-templates", accountId],
    queryFn: async () => {
      const { data } = await supabase
        .from("monitor_action_templates")
        .select("*")
        .eq("account_id", accountId)
        .order("position", { ascending: true });
      return data ?? [];
    },
  });

  const historyQuery = useQuery({
    queryKey: ["monitor-history", accountId],
    queryFn: async () => {
      const [checks, events, actions] = await Promise.all([
        supabase
          .from("monitor_checks")
          .select("*")
          .eq("account_id", accountId)
          .order("checked_at", { ascending: false })
          .limit(30),
        supabase
          .from("monitor_events")
          .select("*")
          .eq("account_id", accountId)
          .order("detected_at", { ascending: false })
          .limit(20),
        supabase
          .from("monitor_actions")
          .select("*")
          .eq("account_id", accountId)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);
      return {
        checks: checks.data ?? [],
        events: events.data ?? [],
        actions: actions.data ?? [],
      };
    },
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["monitor-account", accountId] });
    void qc.invalidateQueries({ queryKey: ["monitor-history", accountId] });
    void qc.invalidateQueries({ queryKey: ["monitor-templates", accountId] });
  };

  const [form, setForm] = useState(EMPTY_TEMPLATE);
  const previewTestOrder = useServerFn(previewTestOrderFn);
  const triggerTestOrder = useServerFn(triggerTestOrderFn);


  const createTemplate = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("monitor_action_templates").insert({
        account_id: accountId,
        name: form.name || "Order",
        service_reference: form.service_reference || null,
        quantity: Math.max(1, Number(form.quantity) || 1),
        target_template: form.target_template || "https://instagram.com/{username}",
        position: Number(form.position) || 0,
        dry_run: form.dry_run,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setForm(EMPTY_TEMPLATE);
      toast.success("Template added");
      invalidate();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not add template"),
  });

  const checkMutation = useMutation({
    mutationFn: () => checkNow({ data: { accountId } }),
    onSuccess: (res) => {
      if (!res.ok) toast.error(res.error ?? "Check failed");
      else toast.success(`Checked — profile is ${res.result}`);
      invalidate();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Check failed"),
  });

  const eventMutation = useMutation({
    mutationFn: () => manualEvent({ data: { accountId } }),
    onSuccess: (res) => {
      toast.success(`Manual event created — ${res.actionsCreated} action(s)`);
      invalidate();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Event failed"),
  });

  const retryMutation = useMutation({
    mutationFn: (actionId: string) => retryAction({ data: { actionId } }),
    onSuccess: (res) => {
      toast[res.ok ? "success" : "error"](res.message ?? `Action ${res.status}`);
      invalidate();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Retry failed"),
  });

  const previewQuery = useQuery({
    queryKey: ["monitor-test-preview", accountId],
    queryFn: () => previewTestOrder({ data: { accountId } }),
    enabled: false,
  });

  const testOrderMutation = useMutation({
    mutationFn: () => triggerTestOrder({ data: { accountId } }),
    onSuccess: (res) => {
      const tick = res.tick;
      toast.success(
        `Test order placed — event ${res.eventCreated ? "created" : "exists"}, ${res.actionsCreated} action(s), ${tick.completed} completed`,
      );
      invalidate();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Test order failed"),
  });

  const account = accountQuery.data;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Monitored profile"
        title={account ? `@${account.username}` : "Loading…"}
        description={
          account
            ? `Last check ${fmt(account.last_checked_at)} · next ${fmt(account.next_check_at)}`
            : undefined
        }
        status={
          account
            ? {
                label:
                  account.is_private === null
                    ? "unknown"
                    : account.is_private
                      ? "private"
                      : "public",
                tone: account.is_private === false ? "success" : "warning",
                live: account.enabled,
              }
            : undefined
        }
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" asChild>
              <Link to="/monitor">
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </Link>
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => checkMutation.mutate()}
              disabled={checkMutation.isPending}
            >
              {checkMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Check now
            </Button>
            <Button size="sm" onClick={() => eventMutation.mutate()} disabled={eventMutation.isPending}>
              <Zap className="h-3.5 w-3.5" /> Manual test event
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => previewQuery.refetch()}
              disabled={previewQuery.isFetching}
            >
              <Eye className="h-3.5 w-3.5" /> Preview order
            </Button>
            <Button size="sm" onClick={() => testOrderMutation.mutate()} disabled={testOrderMutation.isPending}>
              {testOrderMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Rocket className="h-3.5 w-3.5" />
              )}
              Test order
            </Button>
          </div>
        }
      />

      {account?.last_error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {account.last_error}
        </div>
      )}

      <Card
        title="Action templates"
        description="Orders that fire — in order — when this profile turns public"
      >
        {(templatesQuery.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">
            No templates yet — a transition would create an event but dispatch nothing.
          </p>
        ) : (
          <ul className="space-y-2">
            {templatesQuery.data!.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium">
                    #{t.position} · {t.name}
                    {t.dry_run && (
                      <span className="ml-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                        dry run
                      </span>
                    )}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    service {t.service_reference ?? "—"} · ×{t.quantity} · {t.target_template}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={t.enabled}
                    onCheckedChange={async (v) => {
                      await supabase
                        .from("monitor_action_templates")
                        .update({ enabled: v })
                        .eq("id", t.id);
                      invalidate();
                    }}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={async () => {
                      await supabase.from("monitor_action_templates").delete().eq("id", t.id);
                      invalidate();
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <ServicePicker
          onSelect={(s: ProviderService) => {
            setForm((f) => ({
              ...f,
              name: f.name || s.name.slice(0, 60),
              service_reference: s.service,
              quantity: String(Math.max(1, s.min)),
            }));
            toast.success(`Service ${s.service} selected · min ${s.min}`);
          }}
        />

        <div className="mt-4 grid gap-3 border-t border-border/60 pt-4 sm:grid-cols-6">

          <Input
            className="sm:col-span-2"
            placeholder="Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Input
            placeholder="Service ref"
            value={form.service_reference}
            onChange={(e) => setForm({ ...form, service_reference: e.target.value })}
          />
          <Input
            type="number"
            min={1}
            placeholder="Qty"
            value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: e.target.value })}
          />
          <Input
            type="number"
            placeholder="Pos"
            value={form.position}
            onChange={(e) => setForm({ ...form, position: e.target.value })}
          />
          <Button
            onClick={() => createTemplate.mutate()}
            disabled={createTemplate.isPending}
            size="sm"
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
          <Input
            className="sm:col-span-5 font-mono text-xs"
            placeholder="https://instagram.com/{username}"
            value={form.target_template}
            onChange={(e) => setForm({ ...form, target_template: e.target.value })}
          />
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch
              checked={form.dry_run}
              onCheckedChange={(v) => setForm({ ...form, dry_run: v })}
            />
            Dry run
          </label>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Check history" description="Every poll, including failures">
          {(historyQuery.data?.checks.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No checks recorded yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {historyQuery.data!.checks.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-xs text-muted-foreground">{fmt(c.checked_at)}</span>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                    {c.error_message ?? ""}
                  </span>
                  <StatusPill kind={c.result === "error" ? "failed" : c.result} label={c.result} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Events & actions" description="Transitions and their dispatch outcomes">
          {(historyQuery.data?.events.length ?? 0) === 0 &&
          (historyQuery.data?.actions.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">Standby — nothing triggered yet.</p>
          ) : (
            <div className="space-y-4">
              <ul className="space-y-1.5">
                {historyQuery.data!.events.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-xs text-muted-foreground">{fmt(e.detected_at)}</span>
                    <span className="text-[11px] text-muted-foreground">{e.trigger_type}</span>
                    <StatusPill
                      kind={e.cooldown_suppressed ? "not_configured" : "completed"}
                      label={e.cooldown_suppressed ? "cooldown" : "fired"}
                    />
                  </li>
                ))}
              </ul>
              <ul className="space-y-2">
                {historyQuery.data!.actions.map((a) => (
                  <li key={a.id} className="rounded-lg border border-border/60 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm">{a.target}</span>
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
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      attempt {a.attempt_count} ·{" "}
                      {a.provider_reference
                        ? `order ${a.provider_reference}`
                        : (a.error_message ?? "no provider reference")}
                    </div>
                    {(a.request_excerpt || a.response_excerpt) && (
                      <details className="mt-1.5">
                        <summary className="cursor-pointer text-[11px] text-muted-foreground">
                          Request / response excerpt
                        </summary>
                        <pre className="mt-1 overflow-x-auto rounded bg-muted/40 p-2 font-mono text-[10px]">
                          {JSON.stringify(
                            { request: a.request_excerpt, response: a.response_excerpt },
                            null,
                            2,
                          )}
                        </pre>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
