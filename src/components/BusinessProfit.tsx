import type { profitEstimate } from "@/lib/business-profit";
const eur = (n: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);
export function BusinessProfit({ value: p }: { value: ReturnType<typeof profitEstimate> }) {
  if (!p)
    return (
      <section className="rounded-2xl border border-amber-300/30 p-6 text-amber-100">
        Gewinn-Schätzung wartet auf vollständige Zahlen für denselben Zeitraum. Die einzelnen
        Quellen stehen unten.
      </section>
    );
  return (
    <section className="space-y-5 rounded-2xl border border-fuchsia-400/30 bg-[#101321] p-6">
      <div>
        <p className="font-mono text-xs tracking-widest text-fuchsia-300">MIDNA // MONEY CHECK</p>
        <h2 className="mt-2 text-2xl font-semibold">Was bleibt für Kiikii?</h2>
        <p className="text-sm text-slate-400">
          {p.start} bis {p.end} · Schätzung vor Steuern und eigener Arbeitszeit
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="relative overflow-hidden rounded-2xl border border-cyan-300/40 bg-gradient-to-br from-cyan-400/15 via-[#101321] to-fuchsia-500/10 p-6 md:p-8">
          <span className="font-mono text-xs tracking-[.2em] text-cyan-200">
            01 // DEIN ERGEBNIS
          </span>
          <h3 className="mt-4 text-lg text-slate-200">Vorläufig übrig</h3>
          <p
            className={`mt-2 break-words text-5xl font-semibold tracking-tight tabular-nums sm:text-6xl ${p.surplus < 0 ? "text-rose-300" : "text-cyan-200"}`}
          >
            {eur(p.surplus)}
          </p>
          <p className="mt-4 text-sm text-slate-400">
            Schätzung für den Zeitraum oben · vor Steuern
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
          {[
            ["Fanvue-Einnahmen", p.revenue, "Nach Fanvue-Gebühr"],
            ["Angesetzte Kosten", p.costs, "Fixkosten + Generation + bezahlte Closer-Abos"],
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
              02 // MONATLICHER AUSBLICK
            </p>
            <h3 className="mt-2 text-lg font-semibold">Laufende Kosten bei diesem Tempo</h3>
          </div>
          <p className="text-3xl font-semibold tabular-nums text-fuchsia-200">
            ≈ {eur(p.monthly)}
            <span className="ml-2 text-sm font-normal text-slate-400">/ 30 Tage</span>
          </p>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {[
            ["Fixkostenanteil", p.fixed],
            ["Generation · hochgerechnet", (p.generation / Number(p.end.slice(-2))) * 30],
            ["Closer & Link · Abo-Mittel", p.monthlySubscriptionsUsd / p.rate],
          ].map(([label, amount]) => (
            <div key={String(label)} className="rounded-xl border border-white/10 bg-black/15 p-4">
              <p className="text-xs text-slate-400">{label}</p>
              <p className="mt-2 text-xl font-semibold tabular-nums">{eur(Number(amount))}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs leading-relaxed text-slate-400">
          Prognose, keine weitere Rechnung. Generation aus dem bisherigen Monat auf 30 Tage
          gerechnet. Aktuelle Abos vom {p.subscriptionDate}; kein Langzeitmittel.
        </p>
      </div>
      <p className="text-sm text-amber-200">
        Alle neun CupidBot-Zahlungen sind zugeordnet. Überschuss nach bezahlten Abos; keine
        periodengerechte Buchhaltung.
      </p>
      <details className="text-sm text-slate-300">
        <summary className="cursor-pointer py-3 text-cyan-200">
          So setzt sich die Rechnung zusammen
        </summary>
        <p className="mb-3">
          Closer: {p.charged} berechnete Gespräche · {p.remaining ?? "unbekannt"} Credits übrig
          (Stand {p.end}). Gesprächswert {p.usageUsd.toFixed(2)} $ ist keine zusätzliche
          Aborechnung. Laufend: {p.subscriptionCount ?? "?"} Abos, {p.subscriptionMonthlyUsd ?? "?"}{" "}
          $ monatlich + {p.subscriptionWeeklyUsd ?? "?"} $ wöchentlich; Wochenbeträge mit 52 / 12
          gemittelt.
        </p>
        <p>
          Aktuelle monatliche Fixkosten: {eur(p.fixed)} · Kiikii-Generation: {eur(p.generation)} ·
          Bezahlte CupidBot-Abos: {eur(p.paid)}.
        </p>
        <p className="mt-2">
          {p.subscriptionNote} Bereits bezahlte Rechnungen bleiben als Ausgaben berücksichtigt.
          Kündigungen reduzieren die künftigen laufenden Kosten, nicht rückwirkend die bisherigen
          Ausgaben.
        </p>
        <p className="mt-2">
          Fixkosten nach heutiger Aufteilung für einen ganzen Monat angesetzt; keine historische
          Buchhaltung. Fanvue-Gebühr bereits im Netto enthalten. Umrechnung: 1 EUR = {p.rate} USD,
          ECB vom {p.fxDay}; kein Livekurs. Quellen und Einzelzahlungen unten.
        </p>
      </details>
    </section>
  );
}
