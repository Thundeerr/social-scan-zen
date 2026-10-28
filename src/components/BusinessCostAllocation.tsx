import { mixedMoney, money, type allocationPlan } from "@/lib/business-cost-allocation";
export function BusinessCostAllocation({ plan }: { plan: ReturnType<typeof allocationPlan> }) {
  if (!plan.entries.length) return null;
  return (
    <section className="space-y-5 rounded-2xl border border-fuchsia-400/30 bg-[#101321] p-5 md:p-6">
      <p className="font-mono text-xs tracking-widest text-fuchsia-300">MIDNA // RUNNING COSTS</p>
      <h2 className="text-2xl font-semibold">Was Kiikii monatlich kostet</h2>
      <p className="text-3xl font-semibold text-cyan-200">{mixedMoney(plan.totals.kiikii)}</p>
      <p className="text-sm text-slate-300">
        Fixkostenanteil ohne Content-Generierung und Closer-Verbrauch. Euro und Dollar werden nicht
        vermischt.
      </p>
      <div className="space-y-3">
        {plan.entries.map((r) => (
          <div
            key={r.reference}
            className="flex justify-between gap-4 border-b border-white/10 pb-3"
          >
            <div>
              <p className="font-semibold">
                {r.label} {r.planned && <span className="text-amber-200">· geplant</span>}
              </p>
              <p className="mt-1 text-sm text-slate-400">{r.note}</p>
            </div>
            <p className="shrink-0 font-semibold text-cyan-200">
              {money(r.monthly_cents, r.currency)}
            </p>
          </div>
        ))}
      </div>
      <p className="text-sm text-slate-400">
        Stand der Aufteilung:{" "}
        {plan.entries.reduce((d, r) => (r.effective_from > d ? r.effective_from : d), "")}. Tuuva
        nutzt künftig dieselbe Infrastruktur. Diese Kosten werden beim zweiten Charakter nicht
        einfach verdoppelt. Historische Zahlungen bleiben erhalten.
      </p>
    </section>
  );
}
