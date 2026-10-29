import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Radio, RefreshCw, Send, AlertTriangle, Wallet, Zap } from "lucide-react";
import { businessReportFn } from "@/lib/business-report.functions";
import { berlinTime, usd } from "@/lib/business-report";
import { Button } from "@/components/ui/button";
import { FanvueAnalyticsConnection } from "@/components/FanvueAnalyticsConnection";
import { InstagramAnalyticsConnection } from "@/components/InstagramAnalyticsConnection";
import { CloserAnalyticsConnection } from "@/components/CloserAnalyticsConnection";
import { WaveSpeedAnalytics } from "@/components/WaveSpeedAnalytics";
import { BusinessCostAllocation } from "@/components/BusinessCostAllocation";
import { BusinessProfit } from "@/components/BusinessProfit";
import { profitEstimate } from "@/lib/business-profit";
import { mixedMoney } from "@/lib/business-cost-allocation";
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
                MIDNA // FINANCE TERMINAL
              </p>
              <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
                KIIKII<span className="text-fuchsia-400">.</span>{" "}
                <span className="font-light text-slate-300">HQ</span>
              </h1>
              <p className="mt-3 text-slate-300">Your money. Your overview. Your next move.</p>
            </div>
            <div className="rounded-lg border border-cyan-300/25 bg-cyan-300/5 px-4 py-3 font-mono text-xs text-cyan-200">
              <div className="flex items-center gap-2">
                <Radio size={14} />
                {r ? date(r.at.day) + " · " + r.at.time : "CONNECTING …"}
              </div>
              <div className="mt-2 text-slate-400">
                BERLIN · {r?.enabled ? "REPORT 20:00" : "REPORT PAUSED"}
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
              {query.isFetching ? "Loading status …" : "Refresh numbers"}
            </Button>
            <Button
              className="h-14 bg-fuchsia-500 text-base font-semibold text-white hover:bg-fuchsia-600"
              onClick={() => action.mutate()}
              disabled={action.isPending || !r}
            >
              <Send size={18} />
              {action.isPending ? "Sending to Telegram …" : "Send report to my Telegram"}
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
            Signal received. Your report is in Telegram. ✓
          </p>
        )}
        {r && <BusinessProfit value={profitEstimate(r.snapshots, r.allocation, r.wave?.report)} />}
        <nav aria-label="Cost overview sections" className="grid grid-cols-3 gap-2">
          {[
            ["#monthly-costs", "01 / Costs"],
            ["#live-heading", "02 / Content"],
            ["#data-sources", "03 / Data"],
          ].map(([href, label]) => (
            <a
              key={href}
              href={href}
              className="flex min-h-14 items-center justify-center rounded-xl border border-cyan-300/20 bg-cyan-300/5 px-2 text-center text-sm font-semibold text-cyan-100 transition-colors hover:bg-cyan-300/15 focus-visible:outline-2 focus-visible:outline-cyan-300"
            >
              {label}
            </a>
          ))}
        </nav>
        <div id="monthly-costs" className="scroll-mt-6 space-y-5">
          {r && <BusinessCostAllocation plan={r.allocation} />}
          <details className="group rounded-2xl border border-cyan-300/20 bg-[#101321] p-5">
            <summary className="cursor-pointer py-2 text-lg font-semibold text-cyan-100">
              Generation & WaveSpeed{" "}
              <span className="mt-1 block text-sm font-normal text-slate-400">
                View usage, balance and allocation
              </span>
            </summary>
            <div className="mt-5">
              <WaveSpeedAnalytics userId={user.id} />
            </div>
          </details>
        </div>
        {query.isPending && <p role="status">Midna is gathering your numbers …</p>}
        {r && (
          <>
            <section
              aria-labelledby="live-heading"
              className="rounded-2xl border border-cyan-400/20 bg-[#101321]/90 p-5 md:p-6"
            >
              <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
                <h2 id="live-heading" className="flex items-center gap-2 text-xl font-semibold">
                  <Zap className="text-cyan-300" size={20} />
                  What's happening?
                </h2>
                <span className="font-mono text-xs text-cyan-200">
                  LIVE FROM INSTASCANNER · {r.at.time}
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Metric
                  label="Published today"
                  value={number(r.live.published_today)}
                  detail="Kiikii · since midnight"
                />
                <Metric
                  label="Scheduled and ready"
                  value={number(r.live.scheduled)}
                  detail={
                    r.live.last_scheduled
                      ? "Last scheduled: " +
                        date(r.live.last_scheduled) +
                        " · " +
                        berlinTime(new Date(r.live.last_scheduled)).time
                      : "No confirmed schedule yet"
                  }
                />
                <Metric
                  label="Waiting for your approval"
                  value={number(r.live.review_pending)}
                  detail="Review pending · not approved yet"
                  pink
                />
              </div>
              <p className="mt-4 text-sm text-slate-400">
                {r.live.jobs_today} new jobs today. Only posts linked to a Kiikii review are counted
                here.
              </p>
            </section>
            <details
              aria-labelledby="money-heading"
              className="rounded-2xl border border-fuchsia-400/20 bg-[#101321]/90 p-5 md:p-6"
            >
              <summary className="cursor-pointer py-2">
                <h2 id="money-heading" className="flex items-center gap-2 text-xl font-semibold">
                  <Wallet className="text-fuchsia-300" size={20} />
                  Top-ups & payment planning
                </h2>
                <span className="font-mono text-xs text-slate-300">
                  MONTH {r.at.day.slice(0, 7)}
                </span>
              </summary>
              <p className="mb-5 mt-3 text-sm text-slate-400">
                Separate payment overview. Do not add these amounts to the costs above again.
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <Metric
                  label="Kiikii · USD payment planning only"
                  value={usd(r.costs.cashPlan)}
                  detail={
                    usd(r.costs.fixed) +
                    " USD fixed share + " +
                    usd(r.costs.topups) +
                    " topped up. EUR fixed share shown separately above."
                  }
                  pink
                />
                <Metric
                  label="Shared top-ups"
                  value={usd(shared)}
                  detail="Shared USD top-ups; not usage costs"
                  pink
                />
                <Metric
                  label="Your monthly budget"
                  value={usd(r.budget)}
                  detail="Stronger warnings as you approach the limit. No automatic stop."
                />
              </div>
              <div className="mt-5 flex justify-between gap-3 text-sm">
                <span>USD subtotal only · EUR excluded · not the full budget picture</span>
                <strong>{progress}%</strong>
              </div>
              <div
                role="progressbar"
                aria-label="Recorded Kiikii fixed costs and top-ups against budget; incomplete"
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
                  <p className="font-semibold">Budget status is not complete yet.</p>
                  <p className="mt-1 text-sm leading-relaxed">
                    Monthly fixed cost allocation: {mixedMoney(r.allocation.totals.kiikii)}. The
                    profit estimate above uses a dated exchange rate. This older payment overview
                    shows USD only. Shared WaveSpeed top-ups are not an extra expense on top of
                    usage.
                  </p>
                </div>
              </div>
              <details className="mt-4 text-sm text-slate-300">
                <summary className="cursor-pointer py-2">View cost details</summary>
                <div className="mt-3 space-y-3">
                  {r.entries
                    .filter((e) => e.kind !== "fixed" || !r.allocation.entries.length)
                    .map((e) => (
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
                            · {e.scope === "shared" ? "shared" : e.scope} · from {date(e.day)}
                          </span>
                        </div>
                        <span className="shrink-0">{usd(e.cents)}</span>
                      </div>
                    ))}
                  <p>
                    Job reservations: {usd(r.live.reserved_month_cents)}. Estimates, not invoices;
                    not added to top-ups.
                  </p>
                  <p>
                    Rough projection of allocated payments: {usd(r.forecast)}. Irregular top-ups and
                    missing costs make this uncertain.
                  </p>
                </div>
              </details>
            </details>
            <section
              aria-labelledby="fans-heading"
              className="rounded-2xl border border-white/10 bg-[#101321]/90 p-5 md:p-6"
            >
              <div className="mb-5 flex flex-wrap justify-between gap-2">
                <h2 id="fans-heading" className="text-xl font-semibold">
                  Fans & revenue
                </h2>
                <span className="font-mono text-xs text-amber-200">
                  LATEST CONFIRMED VALUES · CHECK TIMESTAMPS
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Metric
                  label="Total Fanvue subscribers"
                  value={number(fanvue?.values["Total subscribers"])}
                  detail={
                    fanvue
                      ? "As of " +
                        new Date(fanvue.observed_at).toLocaleString("de-DE", {
                          timeZone: "Europe/Berlin",
                        })
                      : "Data missing"
                  }
                />
                <Metric
                  label="Fanvue net revenue"
                  value={
                    fanvue?.values["Net before operating costs, USD"] === undefined
                      ? "—"
                      : usd(fanvue.values["Net before operating costs, USD"] * 100)
                  }
                  detail={
                    fanvue
                      ? `${date(fanvue.period_start)} – ${date(fanvue.period_end)} · before operating costs`
                      : "Data missing"
                  }
                  pink
                />
                <Metric
                  label="Instagram-Follower"
                  value={number(instagram?.values["Total followers"])}
                  detail={
                    instagram
                      ? (instagram.source === "Instagram API"
                          ? "API fetched on "
                          : "Recorded on ") + date(instagram.observed_at)
                      : "Data missing"
                  }
                />
              </div>
              <p className="mt-4 text-sm text-slate-400">
                Cost per new follower / paying subscriber: not available yet. Costs, dates and new
                fans must cover the same period.
              </p>
              <details className="mt-5">
                <summary className="cursor-pointer py-3 text-sm text-cyan-200">
                  Show sources & individual values
                </summary>
                <div className="space-y-2">
                  {r.snapshots.map((s) => (
                    <details key={s.source} className="rounded-lg border border-white/10 p-3">
                      <summary className="cursor-pointer text-sm">
                        <span className="font-semibold">{s.source}</span>
                        <span className="ml-3 text-slate-400">
                          {date(s.observed_at)} ·{" "}
                          {s.observed_at.slice(0, 10) < r.at.day
                            ? "older snapshot"
                            : s.source.endsWith(" API")
                              ? "API-Abruf"
                              : "manually recorded"}
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
              </details>
            </section>
          </>
        )}
        <details
          id="data-sources"
          className="scroll-mt-6 rounded-2xl border border-white/15 bg-[#101321] p-5 md:p-6"
        >
          <summary className="cursor-pointer py-2 text-xl font-semibold">
            Data & connections{" "}
            <span className="mt-1 block text-sm font-normal text-slate-400">
              Fanvue, Instagram and Closer · check status or connect
            </span>
          </summary>
          <div className="mt-6 space-y-5">
            <FanvueAnalyticsConnection userId={user.id} />
            <InstagramAnalyticsConnection userId={user.id} />
            <CloserAnalyticsConnection userId={user.id} />
          </div>
        </details>
        <footer className="flex flex-wrap justify-between gap-2 border-t border-white/10 pt-4 font-mono text-xs text-slate-400">
          <span>KIIKII HQ // NO GUESSWORK</span>
          <span>Does it make the boat go faster?</span>
        </footer>
      </div>
    </main>
  );
}
