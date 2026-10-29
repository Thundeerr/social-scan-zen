import { mixedMoney, money, type allocationPlan } from "@/lib/business-cost-allocation";
export function BusinessCostAllocation({ plan }: { plan: ReturnType<typeof allocationPlan> }) {
  if (!plan.entries.length) return null;
  return (
    <section className="space-y-5 rounded-2xl border border-fuchsia-400/30 bg-[#101321] p-5 md:p-6">
      <p className="font-mono text-xs tracking-widest text-fuchsia-300">MIDNA // RUNNING COSTS</p>
      <h2 className="text-2xl font-semibold">Fixed cost details</h2>
      <p className="text-3xl font-semibold text-cyan-200">{mixedMoney(plan.totals.kiikii)}</p>
      <p className="text-sm text-slate-300">
        Fixed cost share excluding content generation and Closer subscriptions. EUR and USD are kept
        separate.
      </p>
      <details>
        <summary className="cursor-pointer rounded-xl border border-fuchsia-300/20 bg-fuchsia-300/5 px-4 py-4 font-semibold text-fuchsia-100">
          Show providers & cost allocation
        </summary>
        <div className="mt-4 space-y-3">
          {plan.entries.map((r) => (
            <div
              key={r.reference}
              className="flex justify-between gap-4 border-b border-white/10 pb-3"
            >
              <div>
                <p className="font-semibold">
                  {r.label} {r.planned && <span className="text-amber-200">· planned</span>}
                </p>
                <p className="mt-1 text-sm text-slate-400">{r.note}</p>
              </div>
              <p className="shrink-0 font-semibold text-cyan-200">
                {money(r.monthly_cents, r.currency)}
              </p>
            </div>
          ))}
        </div>
      </details>
      <p className="text-sm text-slate-400">
        Allocation as of:{" "}
        {plan.entries.reduce((d, r) => (r.effective_from > d ? r.effective_from : d), "")}. Tuuva
        will use the same infrastructure. These costs do not simply double with a second character.
        Historical payments are preserved.
      </p>
    </section>
  );
}
