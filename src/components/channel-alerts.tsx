import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { channelAlertsFn } from "@/lib/channel-alerts.functions";
import type { AlertAction, AlertChannel } from "@/lib/channel-alerts";
import { Button } from "./ui/button";
export function ChannelAlerts({ userId }: { userId: string }) {
  const cache = useQueryClient(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const key = ["channel-alerts", userId];
  const query = useQuery({
    queryKey: key,
    queryFn: () => channelAlertsFn({ data: { action: "status" } }),
    refetchInterval: 60000,
  });
  async function act(data: AlertAction) {
    setBusy(true);
    setError("");
    try {
      await channelAlertsFn({ data });
      await cache.invalidateQueries({ queryKey: key });
    } catch {
      setError("Aktion fehlgeschlagen. Bitte erneut versuchen.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="rounded-xl border bg-card p-4">
      <summary className="cursor-pointer font-medium">
        Channel-Ankündigungen · Kiikii & Tuuva
      </summary>
      <p className="my-3 text-sm text-muted-foreground">
        Nach erfolgreichem Cloud-Post: höchstens einmal pro Kalendertag je Channel (deutsche Zeit).
        Löschung nach 12 Stunden, geprüft im Minutentakt. Manuell auf Instagram gepostete Beiträge
        werden hier noch nicht erkannt.
      </p>
      {error && <p role="alert">{error}</p>}
      {query.error && <p role="alert">Channel-Status nicht erreichbar.</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {query.data?.channels.map((c) => (
          <Channel
            key={c.model}
            channel={c}
            busy={busy}
            connections={query.data.connections}
            act={act}
          />
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Letzter Cloud-Check:{" "}
        {query.data?.last_tick
          ? new Date(query.data.last_tick).toLocaleString("de-DE", { timeZone: "Europe/Berlin" })
          : "noch ausstehend"}
      </p>
      {query.data?.alerts.map((a) => (
        <p key={a.id} className="mt-2 text-sm">
          {a.model}:{" "}
          {a.state === "deleted"
            ? "Ankündigung gelöscht"
            : a.state === "sent"
              ? `Löschung geplant: ${a.delete_after ? new Date(a.delete_after).toLocaleString("de-DE", { timeZone: "Europe/Berlin" }) : "offen"}`
              : a.state === "uncertain"
                ? "Versand unklar – Channel bitte prüfen"
                : a.state === "delete_failed"
                  ? "Löschung fehlgeschlagen – Nachricht bitte manuell entfernen"
                  : a.state === "skipped"
                    ? "Ankündigung ausgelassen"
                    : a.state === "deleting"
                      ? "Wird gelöscht"
                      : a.state === "sending"
                        ? "Wird gesendet"
                        : "Wartet"}
          {a.error_code === "delete_retry" ? " · Löschung wird erneut versucht" : ""}
        </p>
      ))}
    </details>
  );
}
function Channel({
  channel: c,
  busy,
  connections,
  act,
}: {
  channel: AlertChannel;
  busy: boolean;
  connections: { id: string; username: string }[];
  act: (a: AlertAction) => Promise<void>;
}) {
  const [connection, setConnection] = useState("");
  const label = c.model === "kiikii" ? "Kiikii" : "Tuuva";
  return (
    <section className="rounded-lg border p-3 space-y-3">
      <h3 className="font-medium">{label}</h3>
      <p className="text-sm">
        {!c.enabled
          ? "Ankündigungen pausiert"
          : !c.ig_username
            ? "Wartet auf zugeordnetes Instagram-Konto"
            : !c.bot_ready
              ? "Bot-Berechtigung noch nicht bestätigt"
              : "Automatische Ankündigungen aktiv"}
      </p>
      <p className="text-xs text-muted-foreground">
        {c.ig_username ? "Instagram: @" + c.ig_username : "Noch keine Instagram-Zuordnung"} ·{" "}
        {c.bot_ready ? "Bot darf posten und eigene Nachrichten löschen" : "Bot-Zugriff prüfen"}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void act({ action: "check", model: c.model })}
        >
          Bot für {label} prüfen
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void act({ action: "configure", model: c.model, enabled: !c.enabled })}
        >
          {c.enabled ? "Pausieren" : "Aktivieren"}
        </Button>
      </div>
      <details>
        <summary className="text-sm cursor-pointer">Instagram-Zuordnung ändern</summary>
        <p className="my-2 text-xs">
          Nur das echte {label}-Konto auswählen. Neue Zuordnungen kündigen keine alten Posts
          nachträglich an.
        </p>
        <select
          aria-label={label + " Instagram-Konto"}
          className="w-full rounded border bg-background p-2 text-sm"
          value={connection}
          onChange={(e) => setConnection(e.target.value)}
        >
          <option value="">Konto auswählen</option>
          {connections.map((a) => (
            <option key={a.id} value={a.id}>
              @{a.username}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !connection}
          className="mt-2"
          onClick={() =>
            void act({ action: "configure", model: c.model, connection_id: connection })
          }
        >
          Dieses Konto gehört zu {label}
        </Button>
        {c.ig_username && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void act({ action: "configure", model: c.model, connection_id: null })}
          >
            Zuordnung entfernen
          </Button>
        )}
      </details>
    </section>
  );
}
