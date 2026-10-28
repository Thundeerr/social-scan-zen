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
          ["Kosten nach Verbrauch", p.costs],
          ["Vorläufig übrig", p.surplus],
        ].map(([label, amount]) => (
          <div key={label} className="rounded-xl bg-white/5 p-5">
            <p className="text-sm text-slate-300">{label}</p>
            <p className="mt-2 text-3xl font-semibold text-cyan-200">{eur(Number(amount))}</p>
          </div>
        ))}
      </div>
      <p className="text-sm text-amber-200">
        Ungeklärter Anbieter-/Linkverbrauch fehlt noch. Das ist kein endgültiger Gewinn.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-cyan-300/20 p-4">
          <h3 className="font-semibold">Closer: {p.charged} berechnete Gespräche</h3>
          <p>
            {p.usageUsd.toFixed(2)} $ verbraucht · {p.remaining ?? "unbekannt"} Gespräche übrig
          </p>
          <p className="mt-2 text-sm text-slate-400">
            8 $ pro 100 Gespräche. Restguthaben ist keine neue Ausgabe. Manuell bestätigter Stand;
            keine 1.001 Gespräche.
          </p>
        </div>
        <div className="rounded-xl border border-fuchsia-300/20 p-4">
          <h3 className="font-semibold">Monat bei diesem Tempo: ca. {eur(p.monthly)}</h3>
          <p className="mt-2 text-sm text-slate-400">
            Aktuelle Fixkosten + Generation + Closer-Verbrauch auf 30 Tage hochgerechnet. Kein
            Langzeitmittel; ungeklärter Linkverbrauch fehlt.
          </p>
        </div>
      </div>
      <details className="text-sm text-slate-300">
        <summary className="cursor-pointer py-2">Rechnung & vorsichtige Alternative</summary>
        <p>
          Aktuelle monatliche Fixkosten: {eur(p.fixed)} · Kiikii-Generation: {eur(p.generation)} ·
          Closer-Verbrauch: {eur(p.usageUsd / p.rate)}.
        </p>
        <p className="mt-2">
          Wenn wir stattdessen sämtliche Anbieteraufladungen ({eur(p.paid)}) abziehen: Kostenbasis{" "}
          {eur(p.cautiousCosts)}, übrig {eur(p.cautiousSurplus)}. Darin steckt auch ungenutztes
          Guthaben. Aufladungen und Verbrauch werden niemals addiert.
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
