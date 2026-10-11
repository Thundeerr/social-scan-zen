import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { modelPublishingFn } from "@/lib/model-publishing.functions";
import type { ModelPublishAction } from "@/lib/model-publishing";
import { models, type ReviewItem } from "@/lib/content-review";
import { Button } from "./ui/button";
export function ModelPublish({ item, dirty }: { item: ReviewItem; dirty: boolean }) {
  const cache = useQueryClient(),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false),
    [mode, setMode] = useState<"normal" | "trial">("normal"),
    [error, setError] = useState("");
  const ref = { id: item.id, revision: item.revision };
  const query = useQuery({
    queryKey: ["model-publication", item.id, item.revision],
    queryFn: () => modelPublishingFn({ data: { action: "status", ...ref } }),
    refetchInterval: 15000,
  });
  const p = query.data;
  async function act(action: ModelPublishAction) {
    setBusy(true);
    setError("");
    try {
      await modelPublishingFn({ data: action });
      setConfirm(false);
      await cache.invalidateQueries({ queryKey: ["model-publication", item.id] });
      await cache.invalidateQueries({ queryKey: ["content-review"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Aktion fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3 rounded-lg border p-3">
      <h3 className="font-medium">Auf Instagram veröffentlichen</h3>
      <p className="text-sm">
        {p?.username
          ? `Ziel: @${p.username} · ${models[item.model]}`
          : `${models[item.model]} zuerst oben mit Instagram verbinden.`}
      </p>
      {p?.status && (
        <p className="text-sm">
          {(
            {
              approved: "Vorbereitet – wartet auf deinen Post-Befehl",
              scheduled: "Zum Posten eingereiht",
              publishing: "Wird veröffentlicht",
              published: "Veröffentlicht",
              failed: "Veröffentlichung gestoppt – bitte prüfen",
            } as Record<string, string>
          )[p.status] ?? p.status}
        </p>
      )}
      {p?.permalink && (
        <a className="block underline" href={p.permalink} target="_blank" rel="noopener noreferrer">
          Post auf Instagram ansehen
        </a>
      )}
      {(error || query.error) && (
        <p role="alert">{error || "Veröffentlichungsstatus nicht erreichbar."}</p>
      )}
      {p?.error && <p role="alert">{p.error}</p>}
      {p?.paused && (
        <p className="text-sm">
          Cloud-Publishing ist pausiert.{" "}
          <a className="underline" href="/publisher#publishing-switch">
            Publishing-Einstellung öffnen
          </a>
        </p>
      )}
      {!p?.post_id && (
        <label className="block text-sm">
          Veröffentlichungsart
          <select
            aria-label="Veröffentlichungsart"
            value={mode}
            disabled={busy}
            onChange={(e) => setMode(e.target.value as "normal" | "trial")}
            className="ml-2 rounded border bg-background p-2"
          >
            <option value="normal">Normales Reel</option>
            <option value="trial">Trial Reel · manuelle Übernahme</option>
          </select>
        </label>
      )}
      {!p?.post_id && (
        <Button
          disabled={busy || dirty || !p?.connected}
          onClick={() => void act({ action: "prepare", publish_mode: mode, ...ref })}
        >
          Veröffentlichung vorbereiten
        </Button>
      )}
      {p?.status === "approved" && (
        <>
          <p className="text-sm">
            Das freigegebene Video und die Caption sind fest übernommen. Cover: erstes Videobild. Es
            {p.publish_mode === "trial"
              ? "wird ein Trial Reel für Nicht-Follower gepostet. Keine automatische Übernahme in den normalen Feed und keine Telegram-Ankündigung."
              : "wird ein normales Reel mit Anzeige im Feed gepostet."}
          </p>
          {confirm ? (
            <div className="rounded border border-primary p-3 space-y-3">
              <p>
                Jetzt als {p.publish_mode === "trial" ? "Trial Reel" : "normales Reel"} auf @
                {p.username} posten?
                {p.publish_mode !== "trial" &&
                  " Die Channel-Ankündigung folgt nach Erfolg, sofern sie aktiviert und heute noch frei ist."}
              </p>
              <Button
                disabled={busy || dirty || p.paused || !p.connected || !p.ig_user_id}
                onClick={() =>
                  void act({
                    action: "publish",
                    ...ref,
                    confirmation: "PUBLISH",
                    publish_mode: p.publish_mode!,
                    ig_user_id: p.ig_user_id!,
                  })
                }
              >
                Jetzt {p.publish_mode === "trial" ? "Trial Reel" : "Reel"} auf @{p.username}{" "}
                veröffentlichen
              </Button>
              <Button variant="outline" onClick={() => setConfirm(false)}>
                Zurück
              </Button>
            </div>
          ) : (
            <Button
              disabled={busy || dirty || p.paused || !p.connected}
              onClick={() => setConfirm(true)}
            >
              Posten …
            </Button>
          )}
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void act({ action: "cancel", ...ref })}
          >
            Vorbereitung zurücknehmen
          </Button>
        </>
      )}
    </section>
  );
}
