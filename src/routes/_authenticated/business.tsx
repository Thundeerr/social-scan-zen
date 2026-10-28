import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Radio, RefreshCw, Send, AlertTriangle, ArrowUpRight, Wallet, Zap } from "lucide-react";
import { businessReportFn } from "@/lib/business-report.functions";
import { berlinTime, usd } from "@/lib/business-report";
import { Button } from "@/components/ui/button";
import { FanvueAnalyticsConnection } from "@/components/FanvueAnalyticsConnection";
import { InstagramAnalyticsConnection } from "@/components/InstagramAnalyticsConnection";
import { CloserAnalyticsConnection } from "@/components/CloserAnalyticsConnection";
import { WaveSpeedAnalytics } from "@/components/WaveSpeedAnalytics";
export const Route = createFileRoute("/_authenticated/business")({ component: Business });
const date = (value: string) =>
  new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Berlin",
  }).format(new Date(value));
const number = (value: number | undefined) =>
  value === undefined ? "—" : value.toLocaleString("de-DE");
function Metric({
  label,
  value,
  detail,
  pink = false,
}: {
  label: string;
  value: string;
  detail: string;
  pink?: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#101321] p-6">
      <p className="text-xs font-medium uppercase tracking-widest text-slate-300">{label}</p>
      <p
        className={
          "my-3 text-4xl font-semibold tracking-tight " +
          (pink ? "text-fuchsia-300" : "text-cyan-200")
        }
      >
        {value}
      </p>
      <p className="text-sm text-slate-400">{detail}</p>
    </div>
  );
}
function Business() {
  const { user } = Route.useRouteContext(),
    cache = useQueryClient(),
    key = ["business-report", user.id];
  const query = useQuery({
    queryKey: key,
    queryFn: () => businessReportFn({ data: { action: "status" } }),
    refetchInterval: 60000,
  });
  const action = useMutation({
    mutationFn: () => businessReportFn({ data: { action: "send" } }),
    onSuccess: (r) => cache.setQueryData(key, r),
  });
  const r = query.data,
    fanvue =
      r?.snapshots.find((s) => s.source === "Fanvue API") ??
      r?.snapshots.find((s) => s.source === "Fanvue"),
    instagram =
      r?.snapshots.find((s) => s.source === "Instagram API") ??
      r?.snapshots.find((s) => s.source === "Instagram");
  const shared = r ? r.costs.sharedFixed + r.costs.sharedTopups : 0,
    progress = r ? Math.min(100, Math.round((r.costs.cashPlan / r.budget) * 100)) : 0;
  return (
    <main
      className="min-h-screen bg-[#090b14] text-slate-100"
      style={{
        backgroundImage:
          "radial-gradient(ellipse at 90% 0%,#c026d315,transparent 45%),radial-gradient(ellipse at 0% 30%,#06b6d410,transparent 40%)",
      }}
    >
      <div className="mx-auto max-w-6xl space-y-8 p-4 pb-16 md:p-8">
        <header className="relative overflow-hidden rounded-2xl border border-fuchsia-400/25 bg-[#101321] p-6 md:p-8">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-10"
            style={{
              backgroundImage:
                "linear-gradient(#a855f720 1px,transparent 1px),linear-gradient(90deg,#a855f720 1px,transparent 1px)",
              backgroundSize: "36px 36px",
            }}
          />
          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="mb-3 font-mono text-xs tracking-[.22em] text-fuchsia-300">
                MIDNA // NIGHT SHIFT
              </p>
              <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
                KIIKII<span className="text-fuchsia-400">.</span>{" "}
                <span className="font-light text-slate-300">HQ</span>
              </h1>
              <p className="mt-3 text-slate-300">Weniger Chaos. Mehr zahlende Fans. 🦇</p>
            </div>
            <div className="rounded-lg border border-cyan-300/25 bg-cyan-300/5 px-4 py-3 font-mono text-xs text-cyan-200">
              <div className="flex items-center gap-2">
                <Radio size={14} />
                {r ? date(r.at.day) + " · " + r.at.time : "VERBINDUNG …"}
              </div>
              <div className="mt-2 text-slate-400">
                BERLIN · {r?.enabled ? "REPORT 20:00" : "REPORT PAUSIERT"}
              </div>
            </div>
          </div>
          <div className="relative mt-6 grid gap-3 sm:grid-cols-2">
            <Button
              className="h-14 border border-cyan-300/30 bg-cyan-300/10 text-base text-cyan-100 hover:bg-cyan-300/20"
              onClick={() => query.refetch()}
              disabled={query.isFetching}
            >
              <RefreshCw size={18} />
              {query.isFetching ? "Hole den Status …" : "Zahlen aktualisieren"}
            </Button>
            <Button
              className="h-14 bg-fuchsia-500 text-base font-semibold text-white hover:bg-fuchsia-600"
              onClick={() => action.mutate()}
              disabled={action.isPending || !r}
            >
              <Send size={18} />
              {action.isPending ? "Ab zu Telegram …" : "Bericht an mein Telegram"}
            </Button>
          </div>
        </header>
        {(query.isError || action.isError) && (
          <p
            role="alert"
            className="rounded-xl border border-rose-400/40 bg-rose-400/10 p-4 text-rose-200"
          >
            {query.error?.message ?? action.error?.message}
          </p>
        )}
        {action.isSuccess && (
          <p role="status" className="text-cyan-200">
            Signal angekommen. Dein Bericht ist in Telegram. ✓
          </p>
        )}
        <FanvueAnalyticsConnection userId={user.id} />
        <InstagramAnalyticsConnection userId={user.id} />
        <CloserAnalyticsConnection userId={user.id} />
        <WaveSpeedAnalytics userId={user.id} />
        {query.isPending && <p role="status">Midna sammelt die Zahlen …</p>}
        {r && (
          <>
            <section
              aria-labelledby="live-heading"
              className="rounded-2xl border border-cyan-400/20 bg-[#101321]/90 p-5 md:p-6"
            >
              <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
                <h2 id="live-heading" className="flex items-center gap-2 text-xl font-semibold">
                  <Zap className="text-cyan-300" size={20} />
                  Was läuft?
                </h2>
                <span className="font-mono text-xs text-cyan-200">
                  LIVE AUS INSTASCANNER · {r.at.time}
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Metric
                  label="Heute veröffentlicht"
                  value={number(r.live.published_today)}
                  detail="Kiikii · seit 00:00 Uhr"
                />
                <Metric
                  label="Bereit im Zeitplan"
                  value={number(r.live.scheduled)}
                  detail={
                    r.live.last_scheduled
                      ? "Letzter Termin: " +
                        date(r.live.last_scheduled) +
                        " · " +
                        berlinTime(new Date(r.live.last_scheduled)).time
                      : "Noch kein bestätigter Vorlauf"
                  }
                />
                <Metric
                  label="Warten auf dein Okay"
                  value={number(r.live.review_pending)}
                  detail="Review offen · noch nicht freigegeben"
                  pink
                />
              </div>
              <p className="mt-4 text-sm text-slate-400">
                {r.live.jobs_today} neue Jobs heute. Hier zählen nur Posts mit einer zugeordneten
                Kiikii-Review.
              </p>
            </section>
            <section
              aria-labelledby="money-heading"
              className="rounded-2xl border border-fuchsia-400/20 bg-[#101321]/90 p-5 md:p-6"
            >
              <div className="mb-5 flex flex-wrap justify-between gap-2">
                <h2 id="money-heading" className="flex items-center gap-2 text-xl font-semibold">
                  <Wallet className="text-fuchsia-300" size={20} />
                  Credits im Blick
                </h2>
                <span className="font-mono text-xs text-slate-300">
                  MONAT {r.at.day.slice(0, 7)}
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Metric
                  label="Kiikii zugeordnet"
                  value={usd(r.costs.cashPlan)}
                  detail={usd(r.costs.fixed) + " fix + " + usd(r.costs.topups) + " aufgeladen"}
                  pink
                />
                <Metric
                  label="Noch aufzuteilen"
                  value={usd(shared)}
                  detail="Gemeinsame Fixkosten & Aufladungen"
                  pink
                />
                <Metric
                  label="Dein Monatsrahmen"
                  value={usd(r.budget)}
                  detail="Warnungen werden lauter. Kein Auto-Stopp."
                />
              </div>
              <div className="mt-5 flex justify-between gap-3 text-sm">
                <span>Bekannter Kiikii-Anteil · kein vollständiger Verbrauch</span>
                <strong>{progress}%</strong>
              </div>
              <div
                role="progressbar"
                aria-label="Erfasste Kiikii-Fixkosten und Aufladungen relativ zum Budget; unvollständig"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
                className="mt-2 h-2 overflow-hidden rounded-full bg-white/10"
              >
                <div
                  className="h-full bg-gradient-to-r from-cyan-400 to-fuchsia-400"
                  style={{ width: progress + "%" }}
                />
              </div>
              <div className="mt-5 flex gap-3 rounded-xl border border-amber-300/25 bg-amber-300/5 p-4 text-amber-100">
                <AlertTriangle className="mt-1 shrink-0" size={19} />
                <div>
                  <p className="font-semibold">Noch kein grünes Licht fürs Budget.</p>
                  <p className="mt-1 text-sm leading-relaxed">
                    Zusammen sind {usd(r.costs.cashPlan + shared)} erfasst. Ein Teil gehört zu
                    Kiikii und Tuuva gemeinsam. Erst zuordnen, dann wissen wir, was Kiikii wirklich
                    kostet. Aufladung ≠ Verbrauch.
                  </p>
                </div>
              </div>
              <details className="mt-4 text-sm text-slate-300">
                <summary className="cursor-pointer py-2">Kosten genauer ansehen</summary>
                <div className="mt-3 space-y-3">
                  {r.entries.map((e) => (
                    <div
                      key={e.reference}
                      className="flex justify-between gap-4 border-b border-white/10 pb-2"
                    >
                      <div>
                        {e.label}
                        <span className="block text-xs text-slate-400">
                          {e.kind === "fixed"
                            ? "monatlich"
                            : e.kind === "topup"
                              ? "Aufladung"
                              : "Verbrauch"}{" "}
                          · {e.scope === "shared" ? "geteilt" : e.scope} · ab {date(e.day)}
                        </span>
                      </div>
                      <span className="shrink-0">{usd(e.cents)}</span>
                    </div>
                  ))}
                  <p>
                    Job-Reservierungen: {usd(r.live.reserved_month_cents)}. Schätzungen, keine
                    Rechnungen; nicht zusätzlich auf Aufladungen gerechnet.
                  </p>
                  <p>
                    Grobe Projektion zugeordneter Zahlungen: {usd(r.forecast)}. Unregelmäßige
                    Aufladungen und fehlende Kosten machen sie unsicher.
                  </p>
                </div>
              </details>
            </section>
            <section
              aria-labelledby="fans-heading"
              className="rounded-2xl border border-white/10 bg-[#101321]/90 p-5 md:p-6"
            >
              <div className="mb-5 flex flex-wrap justify-between gap-2">
                <h2 id="fans-heading" className="text-xl font-semibold">
                  Fans & Einnahmen
                </h2>
                <span className="font-mono text-xs text-amber-200">
                  LETZTE BESTÄTIGTE WERTE · ZEITSTEMPEL BEACHTEN
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Metric
                  label="Fanvue-Subs gesamt"
                  value={number(fanvue?.values["Subs gesamt"])}
                  detail={
                    fanvue
                      ? "Stand " +
                        new Date(fanvue.observed_at).toLocaleString("de-DE", {
                          timeZone: "Europe/Berlin",
                        })
                      : "Daten fehlen"
                  }
                />
                <Metric
                  label="Fanvue netto"
                  value={
                    fanvue?.values["Netto vor Betriebskosten USD"] === undefined
                      ? "—"
                      : usd(fanvue.values["Netto vor Betriebskosten USD"] * 100)
                  }
                  detail={
                    fanvue
                      ? `${date(fanvue.period_start)} – ${date(fanvue.period_end)} · vor Betriebskosten`
                      : "Daten fehlen"
                  }
                  pink
                />
                <Metric
                  label="Instagram-Follower"
                  value={number(instagram?.values["Follower gesamt"])}
                  detail={
                    instagram
                      ? (instagram.source === "Instagram API" ? "API-Abruf am " : "Abgelesen am ") +
                        date(instagram.observed_at)
                      : "Daten fehlen"
                  }
                />
              </div>
              <p className="mt-4 text-sm text-slate-400">
                Kosten pro neuem Follower / zahlendem Sub: noch offen. Dafür müssen Kosten, Zeitraum
                und neue Fans zusammenpassen.
              </p>
              <div className="mt-5 space-y-2">
                {r.snapshots.map((s) => (
                  <details key={s.source} className="rounded-lg border border-white/10 p-3">
                    <summary className="cursor-pointer text-sm">
                      <span className="font-semibold">{s.source}</span>
                      <span className="ml-3 text-slate-400">
                        {date(s.observed_at)} ·{" "}
                        {s.observed_at.slice(0, 10) < r.at.day
                          ? "älterer Stand"
                          : s.source.endsWith(" API")
                            ? "API-Abruf"
                            : "manuell erfasst"}
                      </span>
                    </summary>
                    <div className="mt-3 text-sm leading-relaxed text-slate-300">
                      <p>
                        {s.period_start === s.period_end ? "Ablesetag" : "Zeitraum"}:{" "}
                        {date(s.period_start)}
                        {s.period_start !== s.period_end ? " – " + date(s.period_end) : ""}
                      </p>
                      {Object.entries(s.values).map(([k, v]) => (
                        <p key={k}>
                          {k}: <strong className="text-white">{number(v)}</strong>
                        </p>
                      ))}
                      <p className="mt-2 text-slate-400">{s.note}</p>
                    </div>
                  </details>
                ))}
              </div>
            </section>
            <aside className="flex gap-4 rounded-2xl border border-cyan-300/20 bg-cyan-300/5 p-5">
              <ArrowUpRight className="shrink-0 text-cyan-300" />
              <div>
                <p className="font-mono text-xs tracking-widest text-cyan-200">
                  MIDNAS NÄCHSTER MOVE
                </p>
                <p className="mt-2">
                  Fanvue, Instagram und WaveSpeed zusammen im täglichen Bericht. Offene Lücken
                  bleiben sichtbar.
                </p>
                <p className="mt-2 text-sm text-slate-400">
                  Fanvue und Instagram werden nach der Verbindung täglich aus der API abgeglichen.
                  WaveSpeed liefert Guthaben und tatsächliche Abrechnungen. Beim Closer ist der
                  Kontofilter noch in Klärung; bis zur Bestätigung bleibt sein Abruf pausiert.
                  Link-Zahlen sind weiterhin manuell. Tapclick fehlt.
                </p>
              </div>
            </aside>
          </>
        )}
        <footer className="flex flex-wrap justify-between gap-2 border-t border-white/10 pt-4 font-mono text-xs text-slate-400">
          <span>KIIKII HQ // NO GUESSWORK</span>
          <span>Does it make the boat go faster?</span>
        </footer>
      </div>
    </main>
  );
}
