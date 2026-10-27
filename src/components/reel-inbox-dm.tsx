import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { reelInboxDmFn } from "@/lib/reel-inbox-dm.functions";
import { Button } from "@/components/ui/button";
import { dmReceiptExplanation } from "@/lib/reel-inbox-dm";

export function ReelInboxDm({ userId }: { userId: string }) {
  const cache = useQueryClient();
  const [setup, setSetup] = useState<{ webhook: string; verifyToken: string }>();
  const query = useQuery({
    queryKey: ["reel-inbox-dm", userId],
    queryFn: () => reelInboxDmFn({ data: { action: "status" } }),
    refetchInterval: 15000,
  });
  const mutation = useMutation({
    mutationFn: reelInboxDmFn,
    onSuccess: (result) => {
      if (result.verifyToken && result.webhook)
        setSetup({ verifyToken: result.verifyToken, webhook: result.webhook });
      void cache.invalidateQueries({ queryKey: ["reel-inbox-dm", userId] });
    },
  });
  const status = query.data && typeof query.data.enabled === "boolean" ? query.data : null;
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="font-medium">Reels per Instagram-DM sammeln</h2>
      <p className="text-sm">
        @kiikii.bat oder @thundeerr999 → direkt an @followerstarteam senden.
      </p>
      <p className="text-sm text-muted-foreground">
        Ohne Zusatz → Kiikii. Für Tuuva schreibe „Tuuva“ direkt beim Teilen dazu. Bitte nicht als
        separate Nachricht danach. Die Reels werden nur gesammelt – keine automatische Generierung.
      </p>
      <p role="status" className="text-sm">
        {query.isError
          ? "DM-Status konnte nicht geladen werden."
          : !status
            ? "DM-Status wird geladen …"
            : !status.readyToConnect
              ? "DM-Verbindung benötigt Einrichtung oder Erneuerung."
              : !status.enabled
                ? "DM-Empfang noch nicht aktiviert."
                : status.lastReceived
                  ? `Letzte zugelassene DM: ${new Date(status.lastReceived).toLocaleString("de-DE")}`
                  : "Empfang eingerichtet. Zustellung durch Meta noch nicht bestätigt – bitte eine Test-DM senden."}
      </p>
      {status?.enabled && (
        <p className="text-xs text-muted-foreground">
          Verifizierte Absender:{" "}
          {status.senders.length ? status.senders.map((s) => `@${s}`).join(", ") : "noch keine"}.
          Verbindung gültig bis{" "}
          {status.expiresAt ? new Date(status.expiresAt).toLocaleDateString("de-DE") : "unbekannt"}.
        </p>
      )}
      {status?.receipts?.map((r, index) => (
        <p key={index} className="text-sm">
          @{r.sender} · {new Date(r.received_at).toLocaleString("de-DE")} ·{" "}
          {r.status === "queued"
            ? `${r.link_count} Reel-Link(s) gespeichert${r.model ? ` · ${r.model === "tuuva" ? "Tuuva" : "Kiikii"}` : ""}`
            : `${dmReceiptExplanation(r.diagnostics)} Bitte ersatzweise den kopierten Reel-Link als Text senden.`}
        </p>
      ))}
      {!!status?.collected?.length && (
        <div className="space-y-2">
          <h3 className="font-medium">Gesammelte Reels</h3>
          {status.collected.map((item, index) => {
            const reel = Array.isArray(item.reel_inbox_items)
              ? item.reel_inbox_items[0]
              : item.reel_inbox_items;
            if (!reel) return null;
            return (
              <div
                key={`${item.model}-${reel.shortcode}-${index}`}
                className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
              >
                <strong>{item.model === "tuuva" ? "Tuuva" : "Kiikii"}</strong>
                <a href={reel.canonical_url} target="_blank" rel="noreferrer" className="underline">
                  Vorlage ansehen
                </a>
                <Button
                  variant="outline"
                  onClick={() => navigator.clipboard.writeText(reel.canonical_url)}
                >
                  Link kopieren
                </Button>
              </div>
            );
          })}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={!status?.readyToConnect || mutation.isPending}
          onClick={() =>
            mutation.mutate({ data: { action: status?.enabled ? "disable" : "enable" } })
          }
        >
          {status?.enabled ? "DM-Empfang pausieren" : "DM-Empfang aktivieren"}
        </Button>
      </div>
      {mutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {mutation.error.message}
        </p>
      )}
      <details>
        <summary className="cursor-pointer text-sm">Einmalige Meta-Einrichtung</summary>
        <p className="my-2 text-sm">
          In der bestehenden Meta-App muss die untenstehende Webhook-Adresse für
          Instagram-Nachrichten bestätigt und das Feld „messages“ abonniert sein. Testrollen oder
          die passende Meta-Freigabe sind erforderlich. Die Aktivierung allein bestätigt noch keine
          echte Zustellung.
        </p>
        <Button
          variant="outline"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate({ data: { action: "setup" } })}
        >
          Einrichtungsdaten anzeigen
        </Button>
        {setup && (
          <div className="mt-2 space-y-2">
            <p className="break-all text-xs">{setup.webhook}</p>
            <Button variant="outline" onClick={() => navigator.clipboard.writeText(setup.webhook)}>
              Webhook-Adresse kopieren
            </Button>
            <Button
              variant="outline"
              onClick={() => navigator.clipboard.writeText(setup.verifyToken)}
            >
              Verify-Token kopieren
            </Button>
            <Button variant="ghost" onClick={() => setSetup(undefined)}>
              Ausblenden
            </Button>
          </div>
        )}
      </details>
    </section>
  );
}
