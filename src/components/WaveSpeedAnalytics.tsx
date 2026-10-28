import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { waveAnalyticsFn } from "@/lib/wavespeed-analytics.functions";
import { Button } from "@/components/ui/button";
import { berlinTime } from "@/lib/business-report";
import { generationRunRate } from "@/lib/wavespeed-analytics";
const dollars = (v: number) =>
  v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 4 }) + " $";
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
      <h2 className="text-xl font-semibold text-cyan-200">⚡ WaveSpeed · echte Kosten</h2>
      <p className="text-sm text-slate-300">
        Automatisch vor dem 20-Uhr-Bericht. Keine Generierung durch diesen Abruf.
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
              ["Guthaben · ganzes Konto", r.balance],
              ["Kiikii · zugeordnet", r.kiikii],
              ["Tuuva · zugeordnet", r.tuuva],
              ["Noch unzugeordnet", r.unassigned],
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
            Monat {r.month} · {r.recordCount} Buchungen · {dollars(r.charged)} abgebucht −{" "}
            {dollars(r.refunded)} erstattet = {dollars(r.net)} Verbrauch. Aufladungen werden nicht
            nochmals addiert.
          </p>
          <p className="text-sm text-slate-400">
            Stand {new Date(r.observed).toLocaleString("de-DE", { timeZone: "Europe/Berlin" })} Uhr.
          </p>
          {berlinTime(new Date(r.observed)).day !== berlinTime().day && (
            <p className="text-amber-200">Älterer Stand – noch keine aktuellen Zahlen.</p>
          )}
          {r.unknownTypes > 0 && (
            <p className="text-amber-200">
              {r.unknownTypes} andere Buchungen sind nicht als Verbrauch eingerechnet. Zuordnung
              prüfen.
            </p>
          )}
          {projection && (
            <div className="rounded-xl border border-fuchsia-400/30 bg-fuchsia-400/5 p-5 space-y-3">
              <h3 className="text-xl font-semibold text-fuchsia-200">
                Content-Output · Monatsplanung
              </h3>
              <p className="text-3xl font-semibold">
                {dollars(projection.total)}{" "}
                <span className="text-base font-normal text-slate-300">
                  / 30 Tage · gesamtes Konto
                </span>
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  ["Kiikii", projection.kiikii],
                  ["Tuuva", projection.tuuva],
                  ["Noch offen", projection.unassigned],
                ].map(([label, value]) => (
                  <p key={String(label)}>
                    {label}
                    <strong className="block text-xl text-cyan-200">
                      {dollars(Number(value))}
                    </strong>
                  </p>
                ))}
              </div>
              <p className="text-sm text-slate-300">
                Bisheriger Nettoverbrauch ÷ {projection.days} Kalendertage × 30. Der laufende Tag
                ist nur teilweise erfasst. Beide Charaktere sind enthalten, ohne gleiche
                Produktionsmenge zu unterstellen.
              </p>
              <p className="text-sm text-amber-100">
                Hochrechnung aus {r.month}, noch kein Durchschnitt abgeschlossener Monate. Enthält
                Bilder, Videos und Revisionen; kein Preis pro freigegebenem Reel. Unzugeordnete
                Kosten bleiben im Kontogesamtwert enthalten.
              </p>
            </div>
          )}
          <details className="text-sm text-slate-300">
            <summary className="cursor-pointer py-2">Tagesverbrauch ansehen</summary>
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
        <p>Noch kein bestätigter WaveSpeed-Abruf.</p>
      )}
      <Button className="h-14 px-8" disabled={m.isPending || s?.pending} onClick={() => m.mutate()}>
        WaveSpeed-Zahlen aktualisieren
      </Button>
      {(s?.pending || m.isSuccess) && (
        <p role="status" className="text-cyan-200">
          Abruf angefordert. Der Statistikdienst prüft alle fünf Minuten; zwischen Abrufen liegen
          mindestens zehn Minuten.
        </p>
      )}
    </section>
  );
}
