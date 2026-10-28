import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { channelAlertTelegramCall } from "./messaging/telegram-transport";
import { waveStatus } from "./wavespeed-analytics.server";
import {
  berlinTime,
  monthlyCosts,
  forecastCash,
  budgetLevel,
  usd,
  type CostEntry,
  type MetricSnapshot,
} from "./business-report";
const db = () => supabaseAdmin as SupabaseClient;
const owner = () => process.env.CONTENT_REVIEW_OWNER_ID ?? "e4ee414f-fbb6-4f82-b5fc-22d74ed6b3cc";
const chat = () => process.env.CONTENT_REVIEW_TELEGRAM_CHAT_ID ?? "8556103033";
function checked<T>(r: { data: T; error: unknown }): T {
  if (r.error) throw new Error("Berichtsdaten momentan nicht erreichbar.");
  return r.data;
}
export async function businessReport(user: string, now = new Date()) {
  const [settingsResult, costResult, snapshotResult, liveResult] = await Promise.all([
    db().from("business_report_settings").select("*").eq("user_id", user).maybeSingle(),
    db().from("business_cost_entries").select("*").eq("user_id", user).order("day").limit(1000),
    db()
      .from("business_metric_snapshots")
      .select("*")
      .eq("user_id", user)
      .order("observed_at", { ascending: false })
      .limit(100),
    db().rpc("business_live_status", { p_user: user }),
  ]);
  const settings = checked(settingsResult);
  const entries = checked(costResult) as CostEntry[];
  if (entries.length >= 1000)
    throw new Error("Kostenliste zu groß: Bericht muss paginiert werden.");
  const snapshots = checked(snapshotResult) as MetricSnapshot[];
  const latest = snapshots.filter(
    (s, i) => snapshots.findIndex((t) => t.source === s.source) === i,
  );
  const live = checked(liveResult) as {
    read_at: string;
    jobs_today: number;
    review_pending: number;
    scheduled: number;
    last_scheduled: string | null;
    published_today: number;
    reserved_month_cents: number;
  };
  const local = berlinTime(now),
    costs = monthlyCosts(entries, local.day),
    budget = settings?.monthly_budget_cents ?? 40000;
  const forecast = forecastCash(costs.fixed, costs.topups, local.day);
  const fv =
    latest.find((s) => s.source === "Fanvue API") ?? latest.find((s) => s.source === "Fanvue");
  const ig =
    latest.find((s) => s.source === "Instagram API") ??
    latest.find((s) => s.source === "Instagram");
  const closer = latest.find((s) => s.source === "Closer API");
  const wave = await waveStatus(user);
  const wr = wave?.report;
  const value = (snapshot: MetricSnapshot | undefined, metric: string) =>
    snapshot?.values[metric]?.toLocaleString("de-DE") ?? "unbekannt";
  const text = [
    "🦇 KIIKII HQ // MIDNAS NIGHT SHIFT",
    `${local.day} · ${local.time} Uhr · Berlin`,
    "",
    "⚡ WAS LÄUFT?",
    `${live.published_today} heute veröffentlicht · ${live.scheduled} eingeplant`,
    `${live.review_pending} warten auf dein Okay. ${live.jobs_today} neue Jobs heute.`,
    live.last_scheduled
      ? `Vorlauf bis ${berlinTime(new Date(live.last_scheduled)).day}, ${berlinTime(new Date(live.last_scheduled)).time} Uhr.`
      : "Noch kein bestätigter Vorlauf. Die Queue braucht Nachschub.",
    "",
    "💸 CREDITS CHECK · " + local.day.slice(0, 7),
    `Kiikii zugeordnet: ${usd(costs.cashPlan)} / ${usd(budget)} Monatsrahmen`,
    `Davon ${usd(costs.fixed)} fix + ${usd(costs.topups)} aufgeladen.`,
    `Noch aufzuteilen: ${usd(costs.sharedFixed + costs.sharedTopups)} gemeinsame Kosten.`,
    "Aufladung ≠ Verbrauch. Zahlungen und Verbrauch werden nicht zusammengezählt.",
    wr
      ? `WaveSpeed · ${wr.month} · Stand ${berlinTime(new Date(wr.observed)).day} ${berlinTime(new Date(wr.observed)).time}:\nGuthaben ${usd(wr.balance * 100)}${wr.balance < 5 ? " ⚠️ niedrig" : ""}\nVerbrauch ${usd(wr.net * 100)}: Kiikii ${usd(wr.kiikii * 100)}, Tuuva ${usd(wr.tuuva * 100)}, unzugeordnet ${usd(wr.unassigned * 100)}.\n${usd(wr.charged * 100)} abgebucht − ${usd(wr.refunded * 100)} erstattet.${wr.unknownTypes ? ` ${wr.unknownTypes} andere Buchungen nicht eingerechnet.` : ""}`
      : "WaveSpeed: bestätigte Abrechnung fehlt.",
    wave?.error
      ? "⚠️ WaveSpeed-Abruf gestört; angezeigte Werte sind der letzte bestätigte Stand."
      : "",
    `Job-Reservierungen: ${usd(live.reserved_month_cents)} – Schätzung, keine Rechnung.`,
    "Warnungen statt Autostopp. Noch kein grünes Licht: Die Kosten-Zuordnung fehlt.",
    "",
    "📡 LETZTE BESTÄTIGTE SIGNALE",
    fv
      ? `Fanvue · ${fv.period_start} bis ${fv.period_end}:\n${value(fv, "Subs gesamt")} Subs gesamt\n${value(fv, "Netto vor Betriebskosten USD")} $ netto vor Betriebskosten. Kein Gewinn.\n${fv.source === "Fanvue API" ? "API-Abruf" : "Manuell erfasst"}: ${berlinTime(new Date(fv.observed_at)).day} ${berlinTime(new Date(fv.observed_at)).time} Uhr.`
      : "Fanvue: Daten fehlen.",
    ig
      ? `Instagram: ${value(ig, "Follower gesamt")} Follower · Stand ${berlinTime(new Date(ig.observed_at)).day}.`
      : "Instagram: Daten fehlen.",
    "Fanvue und Instagram nach Verbindung täglich per API; Zeitstempel beachten.",
    closer
      ? `Closer · ${closer.period_start} bis ${closer.period_end}: ${value(closer, "Gespräche gesamt")} Gespräche → ${value(closer, "Link verschickt")} Links → ${value(closer, "Conversions (Closer, keine bestätigten Subs)")} gemeldete Conversions.`
      : "Closer: Kontofilter beim Support in Klärung. Automatischer Abruf pausiert.",
    "Closer-Conversions sind keine bestätigten bezahlten Subs. Tapclick fehlt.",
    "Kosten pro neuem Follower / zahlendem Sub: noch unbekannt.",
    "",
    "🎯 NÄCHSTER MOVE",
    "Unzugeordnete Kosten prüfen; Closer-Supportantwort und Link-Statistiken fehlen noch.",
    "Unten auf Status Kiikii tippen für alle Zahlen und Zeiträume.",
  ].join("\n");
  return {
    text,
    entries,
    snapshots: latest,
    live,
    costs,
    budget,
    forecast,
    enabled: settings?.enabled === true,
    wave,
    at: local,
  };
}
export async function sendBusinessReport(user: string, key: string, text: string) {
  if (user !== owner()) throw new Error("Kein privater Berichtskanal für diesen Benutzer.");
  if (text.length > 4000) throw new Error("Bericht zu lang für Telegram.");
  const reservation = await db().from("business_report_deliveries").insert({ user_id: user, key });
  if (reservation.error?.code === "23505") return { duplicate: true };
  if (reservation.error) throw new Error("Bericht konnte nicht reserviert werden.");
  const result = await channelAlertTelegramCall("sendMessage", {
    chat_id: chat(),
    text,
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "Status Kiikii",
            web_app: { url: "https://instascanner.app/telegram-review?view=business" },
          },
        ],
      ],
    },
  });
  const message = result.result as { message_id?: number; chat?: { id?: number } } | undefined;
  const ok =
    result.ok && Number.isSafeInteger(message?.message_id) && String(message?.chat?.id) === chat();
  checked(
    await db()
      .from("business_report_deliveries")
      .update({ state: ok ? "sent" : "uncertain", message_id: ok ? message!.message_id : null })
      .eq("user_id", user)
      .eq("key", key),
  );
  if (!ok) throw new Error("Telegram-Versand unbestätigt. Kein automatischer Neuversand.");
  return { sent: true };
}
export async function businessTick(request: Request) {
  const headers = { "cache-control": "no-store" };
  const candidate = request.headers.get("x-cron-secret");
  if (!candidate || candidate.length > 1024)
    return new Response("Unauthorized", { status: 401, headers });
  const verified = await db().rpc("verify_publisher_cron_secret", { _candidate: candidate });
  if (verified.error || verified.data !== true)
    return new Response("Unauthorized", { status: 401, headers });
  try {
    const settings = checked(
      await db()
        .from("business_report_settings")
        .select("enabled")
        .eq("user_id", owner())
        .maybeSingle(),
    );
    if (!settings?.enabled) return Response.json({ paused: true }, { headers });
    const local = berlinTime();
    if (local.hour >= 19 && (local.hour >= 20 || Number(local.time.slice(3)) >= 55)) {
      const { syncFanvue } = await import("./fanvue-analytics.server");
      try {
        await syncFanvue(owner());
      } catch {
        /* Last good values retain their timestamp; UI shows sync error. */
      }
      const { syncInstagramAnalytics } = await import("./instagram-analytics.server");
      try {
        await syncInstagramAnalytics(owner());
      } catch {
        /* Analytics failure never blocks the report or publishing. */
      }
      const { syncCloser } = await import("./closer-analytics.server");
      try {
        await syncCloser(owner());
      } catch {
        /* Keep last timestamped evidence. */
      }
    }
    const report = await businessReport(owner());
    if (!report.enabled) return Response.json({ paused: true }, { headers });
    const month = report.at.day.slice(0, 7),
      level = budgetLevel(report.costs.cashPlan, report.budget);
    const waveReport = report.wave?.report;
    if (waveReport?.month === month) {
      const actual = report.costs.fixed + Math.round(waveReport.kiikii * 100);
      const actualLevel = budgetLevel(actual, report.budget);
      if (actualLevel)
        await sendBusinessReport(
          owner(),
          `usage-budget:${month}:${actualLevel}`,
          `VERBRAUCH ${actualLevel}% · Kiikii\nFixkosten + zugeordneter WaveSpeed-Verbrauch: ${usd(actual)} / ${usd(report.budget)}.\nGemeinsame Kosten und andere variable Anbieter noch unvollständig. Aufladungen nicht addiert. Kein Autostopp.`,
        );
    }
    if (level)
      await sendBusinessReport(
        owner(),
        `budget:${month}:${level}`,
        `BUDGET ${level}% · Kiikii\nErfasste Fixkosten + Aufladungen: ${usd(report.costs.cashPlan)} / ${usd(report.budget)}.\nGemeinsame Kosten fehlen in dieser Zuordnung. Kein automatischer Stopp.`,
      );
    if (report.forecast > report.budget && !level)
      await sendBusinessReport(
        owner(),
        `forecast:${month}`,
        `BUDGET-PROJEKTION · Kiikii\nGrob ${usd(report.forecast)} bis Monatsende bei unverändertem Zahlungstempo. Aufladungen sind unregelmäßig; keine Verbrauchsprognose. Bitte Kosten prüfen.`,
      );
    if (
      report.costs.sharedTopups + report.costs.sharedFixed + report.costs.cashPlan >=
      report.budget
    )
      await sendBusinessReport(
        owner(),
        `allocation:${month}`,
        `KOSTEN-ZUORDNUNG FEHLT\nAlle erfassten Zahlungen + Fixkosten zusammen: ${usd(report.costs.sharedTopups + report.costs.sharedFixed + report.costs.cashPlan)}. Darin sind geteilte Kiikii/Tuuva-Kosten. Ob Kiikii allein über ${usd(report.budget)} liegt, ist noch unklar.`,
      );
    if (report.at.hour >= 20)
      await sendBusinessReport(owner(), `daily:${report.at.day}`, report.text);
    return Response.json({ ok: true }, { headers });
  } catch {
    return Response.json(
      { error: "Bericht fehlgeschlagen. Versandprotokoll prüfen." },
      { status: 503, headers },
    );
  }
}
