import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { closerAnalyticsFn } from "@/lib/closer-analytics.functions";
import { Button } from "@/components/ui/button";
export function CloserAnalyticsConnection({ userId }: { userId: string }) {
  const [token, setToken] = useState("");
  const cache = useQueryClient(),
    key = ["closer-analytics", userId];
  const q = useQuery({
    queryKey: key,
    queryFn: () => closerAnalyticsFn({ data: { action: "status" } }),
  });
  const m = useMutation({
    mutationFn: (action: "configure" | "sync") =>
      closerAnalyticsFn({ data: action === "configure" ? { action, token } : { action } }),
    onSettled: async () => {
      setToken("");
      await cache.invalidateQueries({ queryKey: key });
      await cache.invalidateQueries({ queryKey: ["business-report", userId] });
    },
  });
  const s = q.data?.status;
  return (
    <section className="rounded-2xl border border-violet-400/30 bg-[#101321] p-5 space-y-4">
      <h2 className="text-xl font-semibold text-violet-200">📡 IG Closer · Kiikii</h2>
      <p className="text-sm text-slate-300">
        Gespräche → Link verschickt → gemeldete Conversion. Täglich vor dem 20-Uhr-Bericht.
      </p>
      {s?.lastSynced && (
        <p className="text-sm text-slate-400">
          Letzter Abruf:{" "}
          {new Date(s.lastSynced).toLocaleString("de-DE", { timeZone: "Europe/Berlin" })} Uhr
        </p>
      )}
      {(q.error || m.error || s?.error) && (
        <p role="alert" className="text-amber-200">
          {q.error?.message ?? m.error?.message ?? s?.error}
        </p>
      )}
      {s && (!s.configured || s.error?.includes("HTTP 401") || s.error?.includes("HTTP 403")) && (
        <div className="space-y-3">
          <p className="text-sm text-slate-300">
            CupidBot → Profile → Account → <strong>Access token</strong>. Hier einfügen, nicht den
            Chatter-Token. Wird verschlüsselt auf dem Server gespeichert.
          </p>
          <label htmlFor="closer-token" className="block text-sm">
            CupidBot Access token
          </label>
          <input
            id="closer-token"
            type="password"
            autoComplete="new-password"
            data-lpignore="true"
            data-1p-ignore="true"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="w-full rounded-lg border border-white/20 bg-black/40 p-3"
          />
          <Button
            className="h-14 w-full bg-violet-600 hover:bg-violet-700"
            disabled={m.isPending || token.trim().length < 16}
            onClick={() => m.mutate("configure")}
          >
            Closer sicher verbinden
          </Button>
        </div>
      )}
      {s?.configured && (
        <Button className="h-14 px-8" disabled={m.isPending} onClick={() => m.mutate("sync")}>
          Closer-Zahlen jetzt holen
        </Button>
      )}
      {m.isPending && <p role="status">Prüfe Closer-Zugang …</p>}
      {m.data?.skipped && (
        <p role="status">Vor Kurzem abgerufen. Frühestens nach 10 Minuten erneut.</p>
      )}
      <p className="text-xs text-slate-400">
        Nur Statistiken für Kiikii. Kein Chatversand. Sieben abgeschlossene Tage; Conversions sind
        keine bestätigten zahlenden Subs.
      </p>
    </section>
  );
}
