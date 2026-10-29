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
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          ["Fanvue netto", p.revenue],
          ["Kosten inkl. bezahlter Abos", p.costs],
          ["Vorläufig übrig", p.surplus],
        ].map(([label, amount]) => (
          <div key={label} className="rounded-xl bg-white/5 p-5">
            <p className="text-sm text-slate-300">{label}</p>
            <p className="mt-2 text-3xl font-semibold text-cyan-200">{eur(Number(amount))}</p>
          </div>
        ))}
      </div>
      <p className="text-sm text-amber-200">
        Alle neun CupidBot-Zahlungen sind zugeordnet. Überschuss nach bezahlten Abos; keine
        periodengerechte Buchhaltung.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-cyan-300/20 p-4">
          <h3 className="font-semibold">Closer: {p.charged} berechnete Gespräche</h3>
          <p>{p.remaining ?? "unbekannt"} Gesprächscredits übrig (Stand {p.end})</p>
          <p className="mt-2 text-sm text-slate-400">
            Tatsächlich bezahlt: 72 $ Instagram + 32 $ Link = 104 $. Der rechnerische Gesprächswert
            von {p.usageUsd.toFixed(2)} $ ist keine Aborechnung und wird nicht zusätzlich berechnet.
          </p>
        </div>
        <div className="rounded-xl border border-fuchsia-300/20 p-4">
          <h3 className="font-semibold">Monat bei diesem Tempo: ca. {eur(p.monthly)}</h3>
          <p className="mt-2 text-sm text-slate-400">
            Aktuelle Fixkosten + Generation auf 30 Tage + {p.monthlySubscriptionsUsd.toFixed(2)} $ monatliches
            Abo-Mittel. Stand {p.subscriptionDate}: {p.subscriptionCount ?? "?"} Abos,
            {" "}{p.subscriptionMonthlyUsd ?? "?"} $ monatlich und {p.subscriptionWeeklyUsd ?? "?"} $ wöchentlich (52 Wochen / 12 Monate). Kein
            Langzeitmittel der Generation.
          </p>
        </div>
      </div>
      <details className="text-sm text-slate-300">
        <summary className="cursor-pointer py-2">Rechnung & laufende Abos</summary>
        <p>
          Aktuelle monatliche Fixkosten: {eur(p.fixed)} · Kiikii-Generation: {eur(p.generation)} ·
          Bezahlte CupidBot-Abos: {eur(p.paid)}.
        </p>
        <p className="mt-2">
          {p.subscriptionNote} Bereits bezahlte Rechnungen bleiben als Ausgaben berücksichtigt.
          Kündigungen reduzieren die künftigen laufenden Kosten, nicht rückwirkend die bisherigen Ausgaben.
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
