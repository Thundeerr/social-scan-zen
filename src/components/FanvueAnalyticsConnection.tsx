import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fanvueAnalyticsFn } from "@/lib/fanvue-analytics.functions";
import { FANVUE_CALLBACK } from "@/lib/fanvue-analytics";
import { Button } from "@/components/ui/button";
export function FanvueAnalyticsConnection({ userId }: { userId: string }) {
  const [secret, setSecret] = useState(""),
    cache = useQueryClient();
  const q = useQuery({
    queryKey: ["fanvue-connection", userId],
    queryFn: () => fanvueAnalyticsFn({ data: { action: "status" } }),
  });
  const mutation = useMutation({
    mutationFn: (action: "configure" | "connect" | "sync" | "disconnect") =>
      fanvueAnalyticsFn({
        data: action === "configure" ? { action, clientSecret: secret } : { action },
      }),
    onSuccess: async (r) => {
      setSecret("");
      cache.setQueryData(["fanvue-connection", userId], r);
      await cache.invalidateQueries({ queryKey: ["business-report", userId] });
      if (r.url) window.location.assign(r.url);
    },
  });
  const s = q.data?.status;
  return (
    <section className="rounded-2xl border border-cyan-400/30 bg-[#101321] p-5 space-y-4">
      <h2 className="text-xl font-semibold text-cyan-200">📡 Fanvue anschließen</h2>
      <p className="text-sm text-slate-300">
        {s?.connected
          ? `Verbunden mit @${s.handle}`
          : "Einmal verbinden. Danach täglich automatisch vor dem 20-Uhr-Bericht."}
      </p>
      {s?.lastSynced && (
        <p className="text-sm text-slate-400">
          Letzter erfolgreicher Abruf:{" "}
          {new Date(s.lastSynced).toLocaleString("de-DE", { timeZone: "Europe/Berlin" })} Uhr
        </p>
      )}
      {typeof window !== "undefined" &&
        new URLSearchParams(window.location.search).get("fanvue") === "error" && (
          <p role="alert" className="text-amber-200">
            Anmeldung nicht abgeschlossen. Bitte nochmals verbinden und @kiikiixoxo auswählen.
          </p>
        )}
      {(q.error || mutation.error || s?.error) && (
        <p role="alert" className="text-amber-200">
          {q.error?.message ?? mutation.error?.message ?? s?.error}
        </p>
      )}
      {s && !s.configured && (
        <div className="space-y-3">
          <p className="text-sm">
            Einmalig den Client Secret deiner App hier einfügen. Er wird verschlüsselt auf dem
            Server gespeichert und danach nicht mehr angezeigt.
          </p>
          <label className="block text-sm" htmlFor="fanvue-secret">
            Fanvue Client Secret
          </label>
          <input
            id="fanvue-secret"
            type="password"
            autoComplete="off"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            className="w-full rounded-lg border border-white/20 bg-black/40 p-3"
          />
          <Button
            className="h-14 w-full"
            disabled={mutation.isPending || secret.trim().length < 16}
            onClick={() => mutation.mutate("configure")}
          >
            Zugang sicher speichern
          </Button>
          <details className="text-sm text-slate-400">
            <summary>Einrichtung in Fanvue</summary>
            <p className="mt-2">
              App: Kiikii HQ Analytics · Leserechte: read:self, read:insights. Rückleitungsadresse:
            </p>
            <code className="break-all">{FANVUE_CALLBACK}</code>
          </details>
        </div>
      )}
      {s?.configured && (
        <div className="flex flex-wrap gap-3">
          {(!s.connected || s.needsReconnect) && (
            <Button
              className="h-14 px-8"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate("connect")}
            >
              Mit Fanvue verbinden
            </Button>
          )}
          {s.connected && !s.needsReconnect && (
            <Button
              className="h-14 px-8"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate("sync")}
            >
              Fanvue-Zahlen jetzt holen
            </Button>
          )}
          {s.connected && (
            <Button
              variant="outline"
              className="h-14"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate("disconnect")}
            >
              Verbindung trennen
            </Button>
          )}
        </div>
      )}
      {mutation.isPending && <p role="status">Verbindung wird bearbeitet …</p>}
      <p className="text-xs text-slate-400">
        Nur Konto & Analytics lesen. Manuelle Abrufe höchstens alle 10 Minuten. Keine Nachrichten,
        Uploads oder Veröffentlichungen. Trennen entfernt die lokal gespeicherten Tokens; den
        App-Zugriff kannst du zusätzlich in Fanvue widerrufen.
      </p>
    </section>
  );
}
