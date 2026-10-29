import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { waveAnalyticsFn } from "@/lib/wavespeed-analytics.functions";
import { Button } from "@/components/ui/button";
import { berlinTime } from "@/lib/business-report";
import { generationRunRate } from "@/lib/wavespeed-analytics";
const dollars = (v: number) =>
  v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 4 }) + " $";
const estimate = (v: number) =>
  v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $";
export function WaveSpeedAnalytics({ userId }: { userId: string }) {
  const cache = useQueryClient(),
    key = ["wavespeed-analytics", userId];
  const q = useQuery({
    queryKey: key,
    queryFn: () => waveAnalyticsFn({ data: { action: "status" } }),
    refetchInterval: 30000,
  });
  const m = useMutation({
    mutationFn: () => waveAnalyticsFn({ data: { action: "sync" } }),
    onSuccess: () => cache.invalidateQueries({ queryKey: key }),
  });
  const s = q.data,
    r = s?.report;
  const projection = r ? generationRunRate(r) : null;
  return (
    <section className="rounded-2xl border border-cyan-400/30 bg-[#101321] p-5 space-y-4">
      <h2 className="text-xl font-semibold text-cyan-200">⚡ WaveSpeed · actual costs</h2>
      <p className="text-sm text-slate-300">
        Synced automatically before the 20:00 report. This sync does not generate content.
      </p>
      {(q.error || m.error || s?.error) && (
        <p role="alert" className="text-amber-200">
          {q.error?.message ?? m.error?.message ?? s?.error}
        </p>
      )}
      {r ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ["Balance · whole account", r.balance],
              ["Kiikii · allocated", r.kiikii],
              ["Tuuva · allocated", r.tuuva],
              ["Unallocated", r.unassigned],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl border border-white/10 p-4">
                <p className="text-sm text-slate-300">{label}</p>
                <p className="mt-2 text-2xl font-semibold text-cyan-200">
                  {dollars(Number(value))}
                </p>
              </div>
            ))}
          </div>
          <p className="text-sm text-slate-400">
            Month {r.month} · {r.recordCount} transactions · {dollars(r.charged)} charged −{" "}
            {dollars(r.refunded)} refunded = {dollars(r.net)} usage. Top-ups are not added again.
          </p>
          <p className="text-sm text-slate-400">
            As of {new Date(r.observed).toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}{" "}
            Berlin time.
          </p>
          {berlinTime(new Date(r.observed)).day !== berlinTime().day && (
            <p className="text-amber-200">Older snapshot — current figures not available yet.</p>
          )}
          {r.unknownTypes > 0 && (
            <p className="text-amber-200">
              {r.unknownTypes} other transactions are not included as usage. Check their allocation.
            </p>
          )}
          {projection && (
            <div className="rounded-xl border border-fuchsia-400/30 bg-fuchsia-400/5 p-5 space-y-3">
              <h3 className="text-xl font-semibold text-fuchsia-200">
                Content output · monthly planning
              </h3>
              <p className="text-3xl font-semibold">
                {estimate(projection.total)}{" "}
                <span className="text-base font-normal text-slate-300">
                  / 30 days · whole account
                </span>
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  ["Kiikii", projection.kiikii],
                  ["Tuuva", projection.tuuva],
                  ["Unassigned", projection.unassigned],
                ].map(([label, value]) => (
                  <p key={String(label)}>
                    {label}
                    <strong className="block text-xl text-cyan-200">
                      {estimate(Number(value))}
                    </strong>
                  </p>
                ))}
              </div>
              <p className="text-sm text-slate-300">
                Net usage so far ÷ {projection.days} calendar days × 30. Today is only partially
                recorded. Both characters are included without assuming equal output.
              </p>
              <p className="text-sm text-amber-100">
                Projection from {r.month}, not an average of completed months. Includes images,
                videos and revisions; not a cost per approved reel. Unallocated costs remain in the
                account total.
              </p>
            </div>
          )}
          <details className="text-sm text-slate-300">
            <summary className="cursor-pointer py-2">View daily usage</summary>
            {Object.entries(r.daily)
              .sort(([a], [b]) => b.localeCompare(a))
              .map(([day, v]) => (
                <p key={day}>
                  {day}: {dollars(v)}
                </p>
              ))}
          </details>
        </>
      ) : (
        <p>No confirmed WaveSpeed sync yet.</p>
      )}
      <Button className="h-14 px-8" disabled={m.isPending || s?.pending} onClick={() => m.mutate()}>
        Refresh WaveSpeed figures
      </Button>
      {(s?.pending || m.isSuccess) && (
        <p role="status" className="text-cyan-200">
          Sync requested. The analytics service checks every five minutes; syncs are at least ten
          minutes apart.
        </p>
      )}
    </section>
  );
}
