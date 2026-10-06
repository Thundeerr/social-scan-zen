import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { reelInboxFn } from "@/lib/reel-inbox.functions";
import { stages, type InboxSnapshot } from "@/lib/reel-inbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ReelInboxDm } from "@/components/reel-inbox-dm";

export const Route = createFileRoute("/_authenticated/reel-inbox")({ component: ReelInbox });
const statuses = {
  queued: "Wartet auf PC",
  working: "PC verarbeitet",
  ready: "Auf PC bestätigt",
  failed: "Aktion erforderlich",
};
const errors: Record<string, string> = {
  unavailable: "Instagram liefert das Reel nicht öffentlich aus. Original-Link bleibt gespeichert.",
  unsupported: "Dieses Reel wird derzeit nicht unterstützt.",
  interrupted: "Download unterbrochen. Erneut versuchen.",
  validation: "Die heruntergeladene Datei hat die Videoprüfung nicht bestanden.",
  path_blocked: "Lokaler Zielpfad ist nicht freigegeben.",
  disk_error: "Dateiablage fehlgeschlagen. Speicherplatz und OneDrive prüfen.",
  conflict: "Dateikonflikt: Es wurde nichts überschrieben.",
  setup: "PC-Helfer oder Videowerkzeuge sind noch nicht eingerichtet.",
};
function ReelInbox() {
  const { user } = Route.useRouteContext();
  const cache = useQueryClient();
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [test, setTest] = useState(false);
  const [message, setMessage] = useState("");
  const [token, setToken] = useState("");
  const [before, setBefore] = useState<string>();
  const key = ["reel-inbox", user.id, before];
  const query = useQuery({
    queryKey: key,
    queryFn: async () => (await reelInboxFn({ data: { action: "list", before } })) as InboxSnapshot,
    refetchInterval: 15000,
  });
  const mutation = useMutation({
    mutationFn: reelInboxFn,
    onSuccess: () => cache.invalidateQueries({ queryKey: ["reel-inbox", user.id] }),
  });
  async function send() {
    setMessage("");
    try {
      const result = await mutation.mutateAsync({ data: { action: "submit", text, test } });
      const count = result.results.filter((r: { duplicate: boolean }) => !r.duplicate).length;
      setMessage(
        `${count} neu gespeichert · ${result.results.length - count} bereits vorhanden${result.invalid.length ? ` · Ungültig: ${result.invalid.join(", ")}` : ""}`,
      );
      setText(result.invalid.join("\n"));
      setBefore(undefined);
    } catch {
      setMessage("Noch nicht bestätigt. Links bleiben hier stehen. Bitte erneut versuchen.");
    }
  }
  const device = query.data?.device;
  const online =
    device &&
    !device.revoked &&
    device.last_seen_at &&
    Date.now() - Date.parse(device.last_seen_at) < 90000;
  const items = (query.data?.items ?? []).filter((i) =>
    `${i.shortcode} ${i.receipt?.title ?? ""} ${i.receipt?.creator ?? ""} ${i.confirmed_stage ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <header>
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Kiikii · Vorlagen</p>
        <h1 className="text-2xl font-semibold">Reel Inbox</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Links einfügen. Senden. Der PC legt verfügbare Reels sicher in deinen Vorlagen ab.
        </p>
      </header>
      <p role="status" className="rounded-lg border p-3 text-sm">
        {online
          ? "PC erreichbar"
          : device?.revoked
            ? "PC-Kopplung widerrufen"
            : "PC offline oder noch nicht gekoppelt"}{" "}
        · Aufträge bleiben online gespeichert.
        {device?.last_seen_at && (
          <span> Zuletzt: {new Date(device.last_seen_at).toLocaleString("de-DE")}</span>
        )}
      </p>
      <ReelInboxDm userId={user.id} />
      <section className="space-y-3 rounded-xl border bg-card p-4">
        <label htmlFor="reels" className="font-medium">
          Instagram-Reel-Links
        </label>
        <Textarea
          id="reels"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder="https://www.instagram.com/reel/…"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={test} onChange={(e) => setTest(e.target.checked)} />
            Als Testmaterial markieren
          </label>
          <Button disabled={!text.trim() || mutation.isPending} onClick={send}>
            Senden
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Bis zu 50 Links. Keine Instagram-Anmeldung erforderlich. Nicht öffentlich abrufbare Reels
          werden als Fehler angezeigt.
        </p>
        {message && (
          <p role="status" className="break-words text-sm">
            {message}
          </p>
        )}
      </section>
      {(query.isError || mutation.isError) && (
        <p role="alert" className="text-destructive">
          {String((query.error || mutation.error)?.message || "Verbindung fehlgeschlagen")}
        </p>
      )}
      <Input
        aria-label="Reels durchsuchen"
        placeholder="Geladene Reels nach Titel, Creator, Status oder ID durchsuchen"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {query.isLoading && <p>Inbox wird geladen …</p>}
      {!query.isLoading && !query.isError && !items.length && (
        <p className="text-muted-foreground">Hier erscheinen deine gespeicherten Links.</p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {items.map((item) => (
          <article key={item.id} className="space-y-3 rounded-xl border bg-card p-4">
            {typeof item.receipt?.thumbnail === "string" && (
              <img
                src={item.receipt.thumbnail}
                alt="Reel-Vorschau"
                loading="lazy"
                className="h-56 w-full rounded-lg object-contain"
              />
            )}
            <div>
              <span className="text-xs text-muted-foreground">
                {item.is_test ? "TESTMATERIAL · " : ""}
                {statuses[item.status]}
              </span>
              <h2 className="break-words font-medium">
                {String(item.receipt?.title || item.shortcode)}
              </h2>
              <p className="text-sm text-muted-foreground">
                {String(item.receipt?.creator || "Creator noch unbekannt")}
              </p>
            </div>
            <a
              href={item.canonical_url}
              target="_blank"
              rel="noreferrer"
              className="text-sm underline"
            >
              Original-Reel öffnen
            </a>
            <p className="text-sm">
              Bestätigt: {item.confirmed_stage || "Noch nicht lokal gespeichert"}
              {item.confirmed_stage && item.desired_stage !== item.confirmed_stage
                ? ` → ${item.desired_stage} angefordert`
                : ""}
            </p>
            {item.receipt && (
              <p className="break-words text-xs text-muted-foreground">
                {String(item.receipt.folder)} ·{" "}
                {Math.round((Number(item.receipt.bytes) / 1024 / 1024) * 10) / 10} MB
                {item.receipt.gallery === false ? " · Galerie-Aktualisierung offen" : ""}
              </p>
            )}
            {item.error_code && (
              <p role="status" className="text-sm text-destructive">
                {errors[item.error_code] || "PC-Fehler. Bitte Status prüfen."}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {item.status === "ready" &&
                stages.map((stage) => (
                  <Button
                    key={stage}
                    size="sm"
                    variant="outline"
                    disabled={mutation.isPending || stage === item.confirmed_stage}
                    onClick={() =>
                      mutation.mutate({ data: { action: "move", id: item.id, stage } })
                    }
                  >
                    {stage}
                  </Button>
                ))}
              {item.status === "failed" && (
                <Button
                  size="sm"
                  onClick={() => mutation.mutate({ data: { action: "retry", id: item.id } })}
                  disabled={mutation.isPending}
                >
                  Erneut versuchen
                </Button>
              )}
            </div>
          </article>
        ))}
      </div>
      <div className="flex gap-2">
        {before && (
          <Button variant="outline" onClick={() => setBefore(undefined)}>
            Neueste
          </Button>
        )}
        {query.data?.items.length === 100 && (
          <Button variant="outline" onClick={() => setBefore(query.data!.items.at(-1)!.created_at)}>
            Ältere laden
          </Button>
        )}
      </div>
      <details className="space-y-3 rounded-xl border p-4">
        <summary className="cursor-pointer font-medium">Windows-PC verbinden / stoppen</summary>
        <p className="text-sm">
          Einen PC koppeln. Ein neuer Schlüssel ersetzt den alten. Den Schlüssel nur in
          „Einrichten.ps1“ auf deinem PC eingeben. Er erlaubt ausschließlich die Verarbeitung deiner
          Reel Inbox.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={mutation.isPending}
            onClick={async () => {
              if (window.confirm("Neuen PC-Schlüssel erstellen und bisherigen widerrufen?")) {
                try {
                  const r = await mutation.mutateAsync({ data: { action: "pair" } });
                  setToken(r.token);
                } catch {
                  /* mutation error is shown */
                }
              }
            }}
          >
            PC-Schlüssel erstellen
          </Button>
          <Button
            variant="outline"
            disabled={mutation.isPending}
            onClick={() => {
              if (window.confirm("PC-Zugriff widerrufen? Dateien bleiben erhalten.")) {
                setToken("");
                mutation.mutate({ data: { action: "revoke" } });
              }
            }}
          >
            PC-Zugriff widerrufen
          </Button>
        </div>
        {token && (
          <div>
            <p className="text-sm">Nur jetzt sichtbar. Nach dem Einrichten ausblenden.</p>
            <Input aria-label="PC-Schlüssel" readOnly type="password" value={token} />
            <Button variant="outline" onClick={() => navigator.clipboard.writeText(token)}>
              Schlüssel kopieren
            </Button>
            <Button variant="ghost" onClick={() => setToken("")}>
              Ausblenden
            </Button>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Am PC: Stoppen.ps1 beendet den Helfer. Deinstallieren.ps1 entfernt Autostart und Kopplung
          auf diesem PC. Deine Medien bleiben erhalten.
        </p>
      </details>
    </div>
  );
}
