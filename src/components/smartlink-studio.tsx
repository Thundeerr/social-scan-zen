import { StudioEmptyState } from "@/components/studio-empty-state";
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Link2,
  MousePointerClick,
  Users,
  Bot,
  Download,
  RefreshCw,
  Plus,
  Pause,
  Check,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { smartlinkFn } from "@/lib/smartlinks.functions";
import { csv, type SmartlinkAction } from "@/lib/smartlinks";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Campaign = {
  id: string;
  name: string;
  template: string;
  status: "draft" | "active" | "paused" | "archived";
  link_count: number;
};
type Account = { id: string; name: string; status: string };
type SmartLink = {
  id: string;
  slug: string;
  target: string;
  domain: string;
  active: boolean;
  campaign_id: string;
  account_id: string | null;
  recipient_id: string | null;
  created_at: string;
};
type Recipient = {
  id: string;
  handle: string;
  name: string;
  consent: string;
  evidence: string;
  message_status: string | null;
  body: string | null;
  error_code: string | null;
  sent_at: string | null;
};
type Overview = {
  campaigns: Campaign[];
  accounts: Account[];
  domains: string[];
  trackingReady: boolean;
};
type Page<T> = { items: T[]; total: number };
type Analytics = {
  total: number;
  human: number;
  bots: number;
  unknown: number;
  unique: number;
  unidentified: number;
  timeline: { day: string; total: number; human: number }[];
  countries: { label: string; count: number }[];
  devices: { label: string; count: number }[];
  referrers: { label: string; count: number }[];
  top: { link_id: string; slug: string; total: number; human: number }[];
  campaigns: { campaign_id: string; name: string; total: number; human: number }[];
};
const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";
const panel = "rounded-xl border border-border bg-card p-5 space-y-4";
function saveCsv(name: string, rows: Record<string, unknown>[], columns: string[]) {
  const url = URL.createObjectURL(
    new Blob([csv(rows, columns)], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-xs text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

export function SmartlinkStudio({ mode }: { mode: "links" | "campaigns" | "analytics" }) {
  const fn = useServerFn(smartlinkFn),
    cache = useQueryClient();
  const api = <T,>(data: SmartlinkAction) => fn({ data }) as Promise<T>;
  const [campaign, setCampaign] = useState(""),
    [target, setTarget] = useState(""),
    [count, setCount] = useState(1000),
    [domain, setDomain] = useState(""),
    [account, setAccount] = useState("");
  const [search, setSearch] = useState(""),
    [offset, setOffset] = useState(0),
    [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [selected, setSelected] = useState<string[]>([]),
    [editTarget, setEditTarget] = useState(""),
    [assignRecipient, setAssignRecipient] = useState("");
  const [name, setName] = useState(""),
    [template, setTemplate] = useState("Hallo {{name}}, hier ist dein Link: {{link}}"),
    [status, setStatus] = useState<Campaign["status"]>("draft");
  const [importText, setImportText] = useState(""),
    [suppressHandle, setSuppressHandle] = useState(""),
    [recipientOffset, setRecipientOffset] = useState(0);
  const [days, setDays] = useState(7),
    [device, setDevice] = useState(""),
    [country, setCountry] = useState(""),
    [linkFilter, setLinkFilter] = useState("");
  const [exporting, setExporting] = useState(false),
    [pendingBatch, setPendingBatch] = useState<Extract<
      SmartlinkAction,
      { action: "generate" }
    > | null>(null);
  const overview = useQuery({
    queryKey: ["smartlinks", "overview"],
    queryFn: () => api<Overview>({ action: "overview" }),
    staleTime: 30000,
  });
  const all = overview.data;
  const chosen = all?.campaigns.find((c) => c.id === campaign);
  const filter = {
    days,
    campaign: campaign || undefined,
    account: account || undefined,
    device: (device as "desktop" | "mobile" | "tablet" | "unknown") || undefined,
    country: country || undefined,
    link: linkFilter || undefined,
  };
  const links = useQuery({
    queryKey: ["smartlinks", "links", campaign, search, offset, sort],
    queryFn: () =>
      api<Page<SmartLink>>({
        action: "links",
        campaign: campaign || undefined,
        search,
        offset,
        sort,
      }),
    enabled: mode === "links",
    refetchInterval: 30000,
  });
  const analytics = useQuery({
    queryKey: ["smartlinks", "analytics", filter],
    queryFn: () => api<Analytics>({ action: "analytics", filter }),
    enabled:
      mode === "analytics" &&
      (!country || country.length === 2) &&
      (!linkFilter ||
        /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
          linkFilter,
        )),
    refetchInterval: 30000,
  });
  const recipients = useQuery({
    queryKey: ["smartlinks", "recipients", campaign, recipientOffset],
    queryFn: () =>
      api<Page<Recipient>>({ action: "recipients", campaign, offset: recipientOffset }),
    enabled: Boolean(campaign) && mode !== "analytics",
    refetchInterval: 30000,
  });
  const mutation = useMutation({
    mutationFn: (data: SmartlinkAction) => api<unknown>(data),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ["smartlinks"] });
      toast.success("Änderung gespeichert.");
      setSelected([]);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const busy = mutation.isPending;
  function changeCampaign(id: string) {
    setCampaign(id);
    setOffset(0);
    setRecipientOffset(0);
    setSelected([]);
    const c = all?.campaigns.find((x) => x.id === id);
    if (c) {
      setName(c.name);
      setTemplate(c.template);
      setStatus(c.status);
    }
  }
  async function generate(retry = false) {
    const payload =
      retry && pendingBatch
        ? pendingBatch
        : {
            action: "generate" as const,
            campaign,
            target,
            count,
            domain: domain || all?.domains[0] || "",
            account: account || null,
            request_id: crypto.randomUUID(),
          };
    setPendingBatch(payload);
    try {
      await mutation.mutateAsync(payload);
      setPendingBatch(null);
      setOffset(0);
    } catch {
      /* keep exact payload for idempotent retry */
    }
  }
  async function exportData(kind: "links" | "recipients") {
    setExporting(true);
    try {
      const rows: Record<string, unknown>[] = [];
      let pos = 0;
      while (true) {
        const page =
          kind === "links"
            ? await api<Page<SmartLink>>({
                action: "links",
                campaign: campaign || undefined,
                search: "",
                sort: "oldest",
                offset: pos,
              })
            : await api<Page<Recipient>>({ action: "recipients", campaign, offset: pos });
        rows.push(
          ...page.items.map((item) =>
            kind === "links"
              ? { ...item, url: (item as SmartLink).domain + "/s/" + (item as SmartLink).slug }
              : item,
          ),
        );
        pos += page.items.length;
        if (pos >= page.total || !page.items.length) break;
      }
      saveCsv(
        `instascanner-${kind}.csv`,
        rows,
        kind === "links"
          ? [
              "id",
              "url",
              "target",
              "campaign_id",
              "account_id",
              "recipient_id",
              "active",
              "created_at",
            ]
          : [
              "handle",
              "name",
              "consent",
              "evidence",
              "message_status",
              "body",
              "error_code",
              "sent_at",
            ],
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export fehlgeschlagen.");
    } finally {
      setExporting(false);
    }
  }
  function importRecipients() {
    try {
      const rows = importText
        .split(/\r?\n/)
        .filter((s) => s.trim())
        .map((line) => {
          const [handle = "", name = "", consent = "unknown", ...evidence] = line.split(";");
          return {
            handle: handle.trim(),
            name: name.trim(),
            consent: consent.trim() as "unknown" | "granted" | "revoked",
            evidence: evidence.join(";").trim(),
          };
        });
      mutation.mutate({ action: "import_recipients", campaign, recipients: rows });
    } catch {
      toast.error("Empfängerformat prüfen.");
    }
  }
  const summary = analytics.data;
  const pageIds = useMemo(() => links.data?.items.map((l) => l.id) || [], [links.data]);
  return (
    <div className="space-y-6">
      <div className="studio-masthead">
        <PageHeader
          eyebrow="Marketing Tools"
          title="SmartLink Studio"
          description="Links zuordnen, Kampagnen verwalten und Ergebnisse messen."
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={() => void cache.invalidateQueries({ queryKey: ["smartlinks"] })}
            >
              <RefreshCw className="h-4 w-4" />
              Aktualisieren
            </Button>
          }
        />
      </div>
      <nav className="flex flex-wrap gap-2" aria-label="SmartLink Studio">
        <Button variant={mode === "links" ? "secondary" : "ghost"} asChild>
          <Link to="/smartlinks">SmartLinks</Link>
        </Button>
        <Button variant={mode === "campaigns" ? "secondary" : "ghost"} asChild>
          <Link to="/smartlinks/campaigns">Campaigns</Link>
        </Button>
        <Button variant={mode === "analytics" ? "secondary" : "ghost"} asChild>
          <Link to="/smartlinks/analytics">Analytics</Link>
        </Button>
      </nav>
      {overview.isLoading && (
        <div role="status" className="flex gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Studio wird geladen …
        </div>
      )}
      {[overview.error, links.error, analytics.error, recipients.error]
        .filter(Boolean)
        .map((e, i) => (
          <div key={i} role="alert" className="rounded-lg border border-destructive/40 p-4 text-sm">
            {(e as Error).message}
            <Button
              variant="ghost"
              onClick={() => void cache.invalidateQueries({ queryKey: ["smartlinks"] })}
            >
              Erneut versuchen
            </Button>
          </div>
        ))}
      {all && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Kampagne">
              <select
                className={selectClass}
                value={campaign}
                onChange={(e) => changeCampaign(e.target.value)}
              >
                <option value="">Alle Kampagnen</option>
                {all.campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.link_count} Links
                  </option>
                ))}
              </select>
            </Field>
            {mode !== "campaigns" && (
              <Field label="Instagram-Account">
                <select
                  className={selectClass}
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                >
                  <option value="">{mode === "links" ? "Ohne Zuordnung" : "Alle Accounts"}</option>
                  {all.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      @{a.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>
          {mode === "links" && (
            <>
              {!all.domains.length && (
                <div role="alert" className={panel}>
                  Noch keine Shortlink-Domain eingerichtet. Eine vorhandene Domain muss für dieses
                  Studio freigeschaltet werden.
                </div>
              )}
              <section className={panel}>
                <div className="flex items-center gap-2">
                  <Link2 className="h-4 w-4 text-primary" />
                  <h2 className="font-medium">SmartLinks generieren</h2>
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void generate();
                  }}
                  className="space-y-4"
                >
                  <Field label="Ziel-URL">
                    <Input
                      type="url"
                      required
                      placeholder="https://deine-seite.de/angebot"
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                    />
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Shortlink-Domain">
                      <select
                        className={selectClass}
                        value={domain || all.domains[0] || ""}
                        onChange={(e) => setDomain(e.target.value)}
                      >
                        {all.domains.map((d) => (
                          <option key={d}>{d}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Anzahl · maximal 1.000 pro Batch">
                      <Input
                        type="number"
                        min={1}
                        max={1000}
                        required
                        value={count}
                        onChange={(e) => setCount(Number(e.target.value))}
                      />
                    </Field>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      disabled={busy || !campaign || !all.domains.length || Boolean(pendingBatch)}
                      type="submit"
                    >
                      <Plus className="h-4 w-4" />
                      {busy
                        ? "Wird erstellt …"
                        : `${count.toLocaleString("de-DE")} Links erstellen`}
                    </Button>
                    {!campaign && (
                      <span className="text-xs text-muted-foreground">
                        Kampagne auswählen oder unter Campaigns erstellen.
                      </span>
                    )}
                    {pendingBatch && !busy && (
                      <>
                        <Button type="button" variant="outline" onClick={() => void generate(true)}>
                          Gleichen Batch sicher erneut prüfen
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => {
                            setPendingBatch(null);
                            toast.info(
                              "Vor einem neuen Batch bitte die Linkliste auf den vorherigen Auftrag prüfen.",
                            );
                          }}
                        >
                          Auftrag verwerfen
                        </Button>
                      </>
                    )}
                  </div>
                </form>
              </section>
              <section className={panel}>
                <div className="flex flex-wrap gap-3 items-center justify-between">
                  <h2 className="font-medium">
                    Links <span className="text-muted-foreground">{links.data?.total ?? 0}</span>
                  </h2>
                  <Button
                    variant="outline"
                    disabled={exporting}
                    onClick={() => void exportData("links")}
                  >
                    <Download className="h-4 w-4" />
                    {exporting ? "Export läuft …" : "Kampagnenlinks exportieren"}
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Input
                    className="sm:max-w-xs"
                    aria-label="Links durchsuchen"
                    placeholder="Slug oder Ziel suchen …"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setOffset(0);
                      setSelected([]);
                    }}
                  />
                  <select
                    aria-label="Sortierung"
                    className={selectClass + " sm:max-w-44"}
                    value={sort}
                    onChange={(e) => {
                      setSort(e.target.value as "newest" | "oldest");
                      setOffset(0);
                    }}
                  >
                    <option value="newest">Neueste zuerst</option>
                    <option value="oldest">Älteste zuerst</option>
                  </select>
                </div>
                {!!selected.length && (
                  <div className="space-y-3 rounded-lg bg-muted/40 p-3">
                    <div className="flex flex-wrap gap-2 items-center">
                      <span className="text-xs">{selected.length} ausgewählt</span>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          mutation.mutate({ action: "update_links", ids: selected, active: false })
                        }
                      >
                        <Pause className="h-3 w-3" />
                        Deaktivieren
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          mutation.mutate({ action: "update_links", ids: selected, active: true })
                        }
                      >
                        <Check className="h-3 w-3" />
                        Aktivieren
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          mutation.mutate({
                            action: "update_links",
                            ids: selected,
                            account: account || null,
                          })
                        }
                      >
                        Account zuordnen
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Input
                        aria-label="Neues Weiterleitungsziel"
                        className="sm:max-w-sm"
                        placeholder="Neues HTTPS-Ziel"
                        value={editTarget}
                        onChange={(e) => setEditTarget(e.target.value)}
                      />
                      <Button
                        variant="outline"
                        disabled={busy || !editTarget}
                        onClick={() =>
                          mutation.mutate({
                            action: "update_links",
                            ids: selected,
                            target: editTarget,
                          })
                        }
                      >
                        Ziel ändern
                      </Button>
                    </div>
                    {campaign && (
                      <div className="flex flex-wrap gap-2">
                        <select
                          aria-label="Autorisierter Empfänger"
                          className={selectClass + " sm:max-w-sm"}
                          value={assignRecipient}
                          onChange={(e) => setAssignRecipient(e.target.value)}
                        >
                          <option value="">Zuordnung entfernen</option>
                          {recipients.data?.items
                            .filter((r) => r.consent === "granted")
                            .map((r) => (
                              <option key={r.id} value={r.id}>
                                @{r.handle}
                              </option>
                            ))}
                        </select>
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            mutation.mutate({
                              action: "update_links",
                              ids: selected,
                              recipient: assignRecipient || null,
                            })
                          }
                        >
                          Empfänger zuordnen
                        </Button>
                      </div>
                    )}
                  </div>
                )}
                {links.isLoading ? (
                  <p role="status" className="text-sm text-muted-foreground">
                    Links werden geladen …
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[680px] text-sm">
                      <thead className="text-xs text-muted-foreground">
                        <tr>
                          <th className="p-3 text-left">
                            <input
                              type="checkbox"
                              aria-label="Alle Links dieser Seite auswählen"
                              checked={
                                pageIds.length > 0 && pageIds.every((id) => selected.includes(id))
                              }
                              onChange={(e) => setSelected(e.target.checked ? pageIds : [])}
                            />
                          </th>
                          <th className="p-3 text-left">SmartLink / Ziel</th>
                          <th className="p-3 text-left">Status</th>
                          <th className="p-3 text-left">Zuordnung</th>
                          <th className="p-3 text-left">Aktionen</th>
                        </tr>
                      </thead>
                      <tbody>
                        {links.data?.items.map((l) => (
                          <tr key={l.id} className="border-t border-border">
                            <td className="p-3">
                              <input
                                type="checkbox"
                                aria-label={`Link ${l.slug} auswählen`}
                                checked={selected.includes(l.id)}
                                onChange={(e) =>
                                  setSelected((s) =>
                                    e.target.checked ? [...s, l.id] : s.filter((id) => id !== l.id),
                                  )
                                }
                              />
                            </td>
                            <td className="p-3 max-w-sm">
                              <span className="block break-all font-mono text-xs">
                                {l.domain}/s/{l.slug}
                              </span>
                              <span className="block break-all text-xs text-muted-foreground mt-1">
                                {l.target}
                              </span>
                            </td>
                            <td className="p-3">
                              <span
                                className={l.active ? "text-emerald-400" : "text-muted-foreground"}
                              >
                                {l.active ? "Aktiv" : "Deaktiviert"}
                              </span>
                            </td>
                            <td className="p-3 text-xs">
                              {all.accounts.find((a) => a.id === l.account_id)?.name || "—"}
                              {l.recipient_id && (
                                <span className="block text-muted-foreground">
                                  Empfänger zugeordnet
                                </span>
                              )}
                            </td>
                            <td className="p-3">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  void navigator.clipboard
                                    .writeText(l.domain + "/s/" + l.slug)
                                    .then(() => toast.success("Link kopiert."))
                                    .catch(() => toast.error("Kopieren nicht möglich."))
                                }
                              >
                                Kopieren
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!links.data?.items.length && (
                      <StudioEmptyState
                        title="Dein erster Link beginnt hier"
                        description="Wähle eine Kampagne, füge deine Ziel-URL ein und erstelle deinen ersten Batch."
                      />
                    )}
                  </div>
                )}
                <Pagination
                  offset={offset}
                  total={links.data?.total || 0}
                  change={(n) => {
                    setOffset(n);
                    setSelected([]);
                  }}
                />
                {campaign && (
                  <Pagination
                    offset={recipientOffset}
                    total={recipients.data?.total || 0}
                    change={setRecipientOffset}
                    label="Empfängerauswahl"
                  />
                )}
              </section>
            </>
          )}
          {mode === "campaigns" && (
            <>
              <section className={panel}>
                <h2 className="font-medium">{chosen ? "Kampagne bearbeiten" : "Neue Kampagne"}</h2>
                <Field label="Name">
                  <Input
                    value={name}
                    maxLength={120}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="November · Creator Launch"
                  />
                </Field>
                <Field label="Nachrichtenvorlage · {{name}} und {{link}}">
                  <Textarea
                    value={template}
                    maxLength={2000}
                    onChange={(e) => setTemplate(e.target.value)}
                  />
                </Field>
                {chosen && (
                  <Field label="Kampagnenstatus">
                    <select
                      className={selectClass}
                      value={status}
                      onChange={(e) => setStatus(e.target.value as Campaign["status"])}
                    >
                      {["draft", "active", "paused", "archived"].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </Field>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={busy || !name.trim()}
                    onClick={() => {
                      if (chosen)
                        mutation.mutate({
                          action: "campaign_update",
                          id: chosen.id,
                          name,
                          template,
                          status,
                        });
                      else mutation.mutate({ action: "create_campaign", name, template });
                    }}
                  >
                    {chosen ? "Speichern" : "Kampagne erstellen"}
                  </Button>
                  {chosen && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        changeCampaign("");
                        setName("");
                      }}
                    >
                      Neue Kampagne
                    </Button>
                  )}
                </div>
              </section>
              <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
                Versand ist deaktiviert. Hier verwaltest du Einwilligungen und Entwürfe. Eine
                Einwilligung allein öffnet kein Instagram-API-Nachrichtenfenster.
              </div>
              {campaign && (
                <>
                  <section className={panel}>
                    <h2 className="font-medium">Empfänger importieren</h2>
                    <Field label="Eine Zeile pro Person: handle;Name;unknown oder granted oder revoked;Nachweis">
                      <Textarea
                        rows={5}
                        value={importText}
                        onChange={(e) => setImportText(e.target.value)}
                        placeholder="creator.name;Alex;granted;Einwilligung vom 02.11.2026 über Formular"
                      />
                    </Field>
                    <p className="text-xs text-muted-foreground">
                      Maximal 1.000 Zeilen. Dubletten bleiben unverändert. Für granted ist ein
                      Nachweis erforderlich; Sperrlisten haben Vorrang.
                    </p>
                    <Button disabled={busy || !importText.trim()} onClick={importRecipients}>
                      Empfänger übernehmen
                    </Button>
                  </section>
                  <section className={panel}>
                    <h2 className="font-medium">Opt-out / Sperrliste</h2>
                    <div className="flex flex-wrap gap-2">
                      <Input
                        className="sm:max-w-sm"
                        aria-label="Zu sperrender Instagram-Handle"
                        value={suppressHandle}
                        onChange={(e) => setSuppressHandle(e.target.value)}
                        placeholder="@handle"
                      />
                      <Button
                        variant="outline"
                        disabled={busy || !suppressHandle}
                        onClick={() =>
                          mutation.mutate({ action: "suppress", handle: suppressHandle })
                        }
                      >
                        Kampagnenübergreifend sperren
                      </Button>
                    </div>
                  </section>
                  <section className={panel}>
                    <div className="flex flex-wrap gap-2 justify-between">
                      <h2 className="font-medium">
                        Empfänger & Entwürfe · {recipients.data?.total ?? 0}
                      </h2>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => mutation.mutate({ action: "assign_recipients", campaign })}
                        >
                          Freie Links automatisch zuordnen
                        </Button>
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => mutation.mutate({ action: "drafts", campaign })}
                        >
                          Entwürfe aus zugeordneten Links erstellen
                        </Button>
                        <Button
                          variant="outline"
                          disabled={exporting}
                          onClick={() => void exportData("recipients")}
                        >
                          <Download className="h-4 w-4" />
                          CSV
                        </Button>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[680px] text-sm">
                        <thead>
                          <tr className="text-left text-xs text-muted-foreground">
                            <th className="p-2">Empfänger</th>
                            <th className="p-2">Einwilligung</th>
                            <th className="p-2">Status / Nachricht</th>
                          </tr>
                        </thead>
                        <tbody>
                          {recipients.data?.items.map((r) => (
                            <tr key={r.id} className="border-t border-border">
                              <td className="p-2">
                                @{r.handle}
                                <span className="block text-xs text-muted-foreground">
                                  {r.name}
                                </span>
                              </td>
                              <td className="p-2">
                                {r.consent}
                                <span className="block max-w-xs break-words text-xs text-muted-foreground">
                                  {r.evidence}
                                </span>
                              </td>
                              <td className="p-2 max-w-lg">
                                <span>{r.message_status || "Kein Entwurf"}</span>
                                <p className="text-xs text-muted-foreground break-words">
                                  {r.body ||
                                    "Autorisierten Empfänger unter SmartLinks einem Link zuordnen."}
                                </p>
                                {r.error_code && <p>{r.error_code}</p>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!recipients.data?.items.length && (
                        <p className="py-8 text-center text-muted-foreground">
                          Noch keine Empfänger importiert.
                        </p>
                      )}
                    </div>
                    <Pagination
                      offset={recipientOffset}
                      total={recipients.data?.total || 0}
                      change={setRecipientOffset}
                    />
                  </section>
                </>
              )}
            </>
          )}
          {mode === "analytics" && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Zeitraum">
                  <select
                    className={selectClass}
                    value={days}
                    onChange={(e) => setDays(Number(e.target.value))}
                  >
                    {[1, 7, 14, 30].map((d) => (
                      <option key={d} value={d}>
                        Letzte {d} Tage
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Gerät">
                  <select
                    className={selectClass}
                    value={device}
                    onChange={(e) => setDevice(e.target.value)}
                  >
                    <option value="">Alle Geräte</option>
                    {["desktop", "mobile", "tablet", "unknown"].map((d) => (
                      <option key={d}>{d}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Land · ISO-Code">
                  <Input
                    placeholder="DE"
                    maxLength={2}
                    value={country}
                    onChange={(e) =>
                      setCountry(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))
                    }
                  />
                </Field>
                <Field label="Einzelner SmartLink · ID">
                  <Input
                    placeholder="UUID aus CSV"
                    value={linkFilter}
                    onChange={(e) => setLinkFilter(e.target.value)}
                  />
                </Field>
              </div>
              {analytics.isLoading && <p role="status">Analytics werden geladen …</p>}
              {summary && (
                <>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <KpiCard
                      label="Total Clicks"
                      value={summary.total}
                      hint="Erfasste Aufrufe inkl. Vorschauen"
                      icon={MousePointerClick}
                    />
                    <KpiCard
                      label="Human Clicks"
                      value={summary.human}
                      hint="Heuristische Einordnung"
                      icon={Users}
                    />
                    <KpiCard
                      label="Unique Visitors ≈"
                      value={summary.unique}
                      hint="Geschätzte Besucher-Tage je Kampagne"
                      icon={Link2}
                    />
                    <KpiCard
                      label="Bot / Preview Hits"
                      value={summary.bots}
                      hint={`${summary.unknown} Aufrufe nicht klassifizierbar`}
                      icon={Bot}
                    />
                  </div>
                  <section className={panel}>
                    <div className="flex flex-wrap justify-between gap-2">
                      <h2 className="font-medium">Klickentwicklung</h2>
                      <span className="text-xs text-muted-foreground">
                        UTC · Aktualisierung alle 30 Sekunden
                      </span>
                    </div>
                    {summary.timeline.length ? (
                      <div className="h-64 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={summary.timeline}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                            <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                            <Tooltip
                              contentStyle={{
                                background: "var(--card)",
                                borderColor: "var(--border)",
                                borderRadius: 8,
                              }}
                            />
                            <Area
                              isAnimationActive={false}
                              name="Alle Aufrufe"
                              dataKey="total"
                              stroke="var(--muted-foreground)"
                              fill="var(--muted)"
                            />
                            <Area
                              isAnimationActive={false}
                              name="Human (geschätzt)"
                              dataKey="human"
                              stroke="var(--primary)"
                              fill="var(--primary)"
                              fillOpacity={0.15}
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <StudioEmptyState
                        icon={MousePointerClick}
                        title="Bereit für die ersten Klicks"
                        description="Teile einen aktiven SmartLink. Sobald er aufgerufen wird, siehst du hier die Kampagnenperformance."
                      />
                    )}
                  </section>
                  <div className="grid gap-4 lg:grid-cols-3">
                    {[
                      ["Länder", summary.countries],
                      ["Geräte", summary.devices],
                      ["Referrer", summary.referrers],
                    ].map(([title, items]) => (
                      <section key={title as string} className={panel}>
                        <h2 className="font-medium">{title as string}</h2>
                        {(items as { label: string; count: number }[]).map((x) => (
                          <div key={x.label} className="flex justify-between gap-3 text-sm">
                            <span className="break-all text-muted-foreground">
                              {x.label === "ZZ" ? "Unbekannt" : x.label}
                            </span>
                            <span className="tabular-nums">{x.count}</span>
                          </div>
                        ))}
                        {!(items as unknown[]).length && (
                          <p className="text-sm text-muted-foreground">Noch keine Daten</p>
                        )}
                      </section>
                    ))}
                  </div>
                  <section className={panel}>
                    <h2 className="font-medium">Top Performing Links</h2>
                    <p className="text-xs text-muted-foreground">
                      CTR: — · Für eine Klickrate fehlen verifizierte Zustellungen oder
                      Impressionen.
                    </p>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[680px] text-sm">
                        <thead>
                          <tr className="text-left text-xs text-muted-foreground">
                            <th className="p-2">Link</th>
                            <th className="p-2">Alle Aufrufe</th>
                            <th className="p-2">Human ≈</th>
                          </tr>
                        </thead>
                        <tbody>
                          {summary.top.map((l) => (
                            <tr key={l.link_id} className="border-t border-border">
                              <td className="p-2">
                                <button
                                  className="text-primary font-mono text-xs"
                                  onClick={() => setLinkFilter(l.link_id)}
                                >
                                  {l.slug}
                                </button>
                              </td>
                              <td className="p-2">{l.total}</td>
                              <td className="p-2">{l.human}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                  <section className={panel}>
                    <div className="flex flex-wrap gap-2 justify-between">
                      <h2 className="font-medium">Kampagnenperformance</h2>
                      <Button
                        variant="outline"
                        onClick={() =>
                          saveCsv("campaign-performance.csv", summary.campaigns, [
                            "campaign_id",
                            "name",
                            "total",
                            "human",
                          ])
                        }
                      >
                        <Download className="h-4 w-4" />
                        CSV
                      </Button>
                    </div>
                    {summary.campaigns.map((c) => (
                      <div className="flex justify-between gap-3 text-sm" key={c.campaign_id}>
                        <span>{c.name}</span>
                        <span>
                          {c.human} Human ≈ / {c.total} Aufrufe
                        </span>
                      </div>
                    ))}
                  </section>
                  <p className="text-xs text-muted-foreground">
                    {!all.trackingReady ? "Besucherschätzung noch nicht konfiguriert. " : ""}
                    {summary.unidentified} Human-Aufrufe ohne Besucherkennung. Keine Cookies oder
                    gespeicherten Roh-IP-Adressen. Aufbewahrung: 30 Tage. Bots können als Menschen
                    erscheinen; Land und Referrer können fehlen. Missbrauchsschutz kann stark
                    wiederholte Aufrufe verwerfen.
                  </p>
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
function Pagination({
  offset,
  total,
  change,
  label = "Einträge",
}: {
  offset: number;
  total: number;
  change: (n: number) => void;
  label?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>
        {label}: {total ? offset + 1 : 0}–{Math.min(offset + 100, total)} / {total}
      </span>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={offset === 0}
          onClick={() => change(Math.max(0, offset - 100))}
        >
          Zurück
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={offset + 100 >= total}
          onClick={() => change(offset + 100)}
        >
          Weiter
        </Button>
      </div>
    </div>
  );
}
