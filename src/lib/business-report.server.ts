import { createHash, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { channelAlertTelegramCall } from "./messaging/telegram-transport";
import {
  berlinTime,
  monthlyCosts,
  forecastCash,
  budgetLevel,
  isStatusCommand,
  usd,
  type CostEntry,
  type MetricSnapshot,
} from "./business-report";
const db = () => supabaseAdmin as SupabaseClient;
const owner = () => process.env.CONTENT_REVIEW_OWNER_ID ?? "e4ee414f-fbb6-4f82-b5fc-22d74ed6b3cc";
const chat = () => process.env.CONTENT_REVIEW_TELEGRAM_CHAT_ID ?? "8556103033";
const endpoint = "https://instascanner.app/api/public/business-report/webhook";
const secret = () =>
  createHash("sha256")
    .update(`business-report:${process.env.CONTENT_REVIEW_BOT_TOKEN}`)
    .digest("hex");
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
  const text = [
    `KIIKII · ${local.day} · ${local.time} Uhr (Berlin)`,
    `Heute bis jetzt: ${live.jobs_today} Jobs angelegt · ${live.published_today} veröffentlicht`,
    `${live.review_pending} zur Prüfung · ${live.scheduled} Posts geplant`,
    live.last_scheduled
      ? `Vorlauf bis ${berlinTime(new Date(live.last_scheduled)).day} ${berlinTime(new Date(live.last_scheduled)).time} Uhr`
      : "Kein bestätigter Vorlauf in der Review-Pipeline.",
    "",
    `MONAT ${local.day.slice(0, 7)} · Budget ${usd(budget)}`,
    `Kiikii: Fixkosten ${usd(costs.fixed)} + Aufladungen ${usd(costs.topups)} = ${usd(costs.cashPlan)}`,
    `Geteilt / noch zuzuordnen: Fixkosten ${usd(costs.sharedFixed)} + Aufladungen ${usd(costs.sharedTopups)}`,
    `Erfasster Kiikii-Verbrauch: ${usd(costs.usage)} (unvollständig; zusätzlich NICHT auf Aufladungen addiert)`,
    `Job-Reservierungen: ${usd(live.reserved_month_cents)} (Schätzung, keine Rechnung)`,
    `Grobe Monatsprojektion nur Kiikii-Zahlungen: ${usd(forecast)}; Aufladungen sind unregelmäßig.`,
    "Budgetbild unvollständig: gemeinsame Kosten und fehlende Buchungen sind nicht zugeordnet. Kein automatischer Stopp.",
    "",
    "LETZTE EXTERNE ZAHLEN (keine automatischen Tageswerte)",
    ...latest.map(
      (s) =>
        `${s.source} · ${s.period_start} bis ${s.period_end}\nStand ${berlinTime(new Date(s.observed_at)).day}: ${Object.entries(
          s.values,
        )
          .map(([k, v]) => `${k}: ${v}`)
          .join(" · ")}\n${s.note}`,
    ),
    ...["Fanvue", "Closer", "Instagram", "Link.me", "Tapclick"]
      .filter((s) => !latest.some((x) => x.source === s))
      .map((s) => `${s}: Daten fehlen.`),
    "",
    "Kosten pro neuem Follower / zahlendem Sub: noch nicht belastbar (gleicher Zeitraum und Kosten-Zuordnung fehlen).",
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
    const report = await businessReport(owner());
    if (!report.enabled) return Response.json({ paused: true }, { headers });
    const month = report.at.day.slice(0, 7),
      level = budgetLevel(report.costs.cashPlan, report.budget);
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
export async function businessWebhook(request: Request) {
  const given = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (
    !process.env.CONTENT_REVIEW_BOT_TOKEN ||
    !/^[a-f0-9]{64}$/.test(given) ||
    !timingSafeEqual(Buffer.from(given), Buffer.from(secret()))
  )
    return new Response("Unauthorized", { status: 401 });
  if (Number(request.headers.get("content-length") ?? 0) > 16000)
    return new Response("", { status: 413 });
  let raw = "";
  const reader = request.body?.getReader();
  if (!reader) return new Response("", { status: 400 });
  let bytes = 0;
  const decoder = new TextDecoder();
  while (true) {
    const p = await reader.read();
    if (p.done) break;
    bytes += p.value.length;
    if (bytes > 16000) {
      await reader.cancel();
      return new Response("", { status: 413 });
    }
    raw += decoder.decode(p.value, { stream: true });
  }
  try {
    const update = JSON.parse(raw),
      m = update.message;
    if (
      !Number.isSafeInteger(update.update_id) ||
      m?.chat?.type !== "private" ||
      String(m?.chat?.id) !== chat() ||
      String(m?.from?.id) !== chat() ||
      !isStatusCommand(m?.text ?? "")
    )
      return Response.json({ ok: true });
    const report = await businessReport(owner());
    await sendBusinessReport(owner(), `update:${update.update_id}`, report.text);
    return Response.json({ ok: true });
  } catch {
    return new Response("", { status: 503 });
  }
}
// Explicit operator action only. Never replace another existing webhook or drop pending updates.
export async function connectBusinessBot(user: string) {
  if (user !== owner()) throw new Error("Nur der eingerichtete Betreiber darf den Bot verbinden.");
  const { configureBusinessWebhook } = await import("./messaging/telegram-transport");
  return configureBusinessWebhook(endpoint, secret());
}
