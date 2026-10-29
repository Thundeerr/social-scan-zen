import type { profitEstimate } from "@/lib/business-profit";
const eur = (n: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);
export function BusinessProfit({ value: p }: { value: ReturnType<typeof profitEstimate> }) {
  if (!p)
    return (
      <section className="rounded-2xl border border-amber-300/30 p-6 text-amber-100">
        The profit estimate needs complete figures for the same period. Individual sources are shown
        below.
      </section>
    );
  return (
    <section className="space-y-5 rounded-2xl border border-fuchsia-400/30 bg-[#101321] p-6">
      <div>
        <p className="font-mono text-xs tracking-widest text-fuchsia-300">MIDNA // MONEY CHECK</p>
        <h2 className="mt-2 text-2xl font-semibold">What does Kiikii keep?</h2>
        <p className="text-sm text-slate-400">
          {p.start} to {p.end} · Estimate before taxes and your own time
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="relative overflow-hidden rounded-2xl border border-cyan-300/40 bg-gradient-to-br from-cyan-400/15 via-[#101321] to-fuchsia-500/10 p-6 md:p-8">
          <span className="font-mono text-xs tracking-[.2em] text-cyan-200">01 // YOUR RESULT</span>
          <h3 className="mt-4 text-lg text-slate-200">Estimated surplus</h3>
          <p
            className={`mt-2 break-words text-5xl font-semibold tracking-tight tabular-nums sm:text-6xl ${p.surplus < 0 ? "text-rose-300" : "text-cyan-200"}`}
          >
            {eur(p.surplus)}
          </p>
          <p className="mt-4 text-sm text-slate-400">
            Estimate for the period above · before taxes
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
          {[
            ["Fanvue-Einnahmen", p.revenue, "After Fanvue fees"],
            ["Included costs", p.costs, "Fixed costs + generation + paid Closer subscriptions"],
          ].map(([label, amount, detail]) => (
            <div
              key={String(label)}
              className="rounded-2xl border border-white/10 bg-[#0c101c] p-5"
            >
              <p className="text-sm text-slate-300">{label}</p>
              <p className="mt-2 text-3xl font-semibold tabular-nums">{eur(Number(amount))}</p>
              <p className="mt-2 text-xs text-slate-400">{detail}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-2xl border border-fuchsia-300/25 bg-fuchsia-400/5 p-5 md:p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-xs tracking-widest text-fuchsia-300">
              02 // MONTHLY OUTLOOK
            </p>
            <h3 className="mt-2 text-lg font-semibold">Running costs at this pace</h3>
          </div>
          <p className="text-3xl font-semibold tabular-nums text-fuchsia-200">
            ≈ {eur(p.monthly)}
            <span className="ml-2 text-sm font-normal text-slate-400">/ 30 days</span>
          </p>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {[
            ["Fixkostenanteil", p.fixed],
            ["Generation · projected", (p.generation / Number(p.end.slice(-2))) * 30],
            ["Closer & Link · subscription average", p.monthlySubscriptionsUsd / p.rate],
          ].map(([label, amount]) => (
            <div key={String(label)} className="rounded-xl border border-white/10 bg-black/15 p-4">
              <p className="text-xs text-slate-400">{label}</p>
              <p className="mt-2 text-xl font-semibold tabular-nums">{eur(Number(amount))}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs leading-relaxed text-slate-400">
          Projection, not another invoice. Generation extrapolated from this month to 30 days.
          Current subscriptions as of {p.subscriptionDate}; not a long-term average.
        </p>
      </div>
      <p className="text-sm text-amber-200">
        All nine CupidBot payments are allocated. Surplus after paid subscriptions; not accrual
        accounting.
      </p>
      <details className="text-sm text-slate-300">
        <summary className="cursor-pointer py-3 text-cyan-200">How the numbers add up</summary>
        <p className="mb-3">
          Closer: {p.charged} charged conversations · {p.remaining ?? "unbekannt"} credits left (as
          of {p.end}). Conversation value {p.usageUsd.toFixed(2)} $ is not an extra subscription
          charge. Active: {p.subscriptionCount ?? "?"} subscriptions,{" "}
          {p.subscriptionMonthlyUsd ?? "?"} $ monthly + {p.subscriptionWeeklyUsd ?? "?"} $ weekly;
          weekly amounts averaged using 52 / 12.
        </p>
        <p>
          Current monthly fixed costs: {eur(p.fixed)} · Kiikii generation: {eur(p.generation)} ·
          Paid CupidBot subscriptions: {eur(p.paid)}.
        </p>
        <p className="mt-2">
          {p.subscriptionNote} Paid invoices remain included as expenses. Cancellations reduce
          future running costs, not past expenses.
        </p>
        <p className="mt-2">
          Fixed costs use today's allocation for a full month; not historical accounting. Fanvue
          fees are already included in net revenue. Exchange rate: 1 EUR = {p.rate} USD, ECB as of{" "}
          {p.fxDay}; not a live rate. Sources and individual payments below.
        </p>
      </details>
    </section>
  );
}
