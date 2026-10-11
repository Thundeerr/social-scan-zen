import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { modelPipelineFn } from "@/lib/model-pipeline.functions";
import { Button } from "./ui/button";
export function ModelPipeline() {
  const cache = useQueryClient(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [token, setToken] = useState("");
  const query = useQuery({
    queryKey: ["model-pipeline"],
    queryFn: () => modelPipelineFn({ data: { action: "status" } }),
    refetchInterval: 30000,
  });
  const p = query.data;
  async function act(action: "pair" | "pause" | "enable") {
    setBusy(true);
    setError("");
    try {
      const result = await modelPipelineFn({ data: { action } });
      if (result.token) setToken(result.token);
      await cache.invalidateQueries({ queryKey: ["model-pipeline"] });
    } catch {
      setError("Aktion nicht bestätigt. Bitte Verbindung prüfen.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="rounded-xl border bg-card p-4">
      <summary className="cursor-pointer font-medium">
        Automatische Reel-Pipeline · 720p · höchstens 3 $ täglich
      </summary>
      <div className="mt-4 space-y-3">
        <p>Instagram → FollowerStar → Generierung → Telegram-Freigabe → Instagram</p>
        <p>
          {p?.enabled ? "Verarbeitung eingeschaltet" : "Verarbeitung pausiert"} ·{" "}
          {p?.last_seen_at
            ? "Server zuletzt gesehen: " + new Date(p.last_seen_at).toLocaleString()
            : "Cloud-Server noch nicht verbunden"}
        </p>
        {(p?.profiles ?? []).map((m: { model: string; sender_username: string | null }) => (
          <p key={m.model}>
            {m.model}:{" "}
            {m.sender_username ? "@" + m.sender_username : "Instagram-Absender noch offen"}
          </p>
        ))}
        <div className="flex gap-2">
          <Button
            disabled={busy || !p?.last_seen_at}
            onClick={() => void act(p?.enabled ? "pause" : "enable")}
          >
            {p?.enabled ? "Generierung pausieren" : "Generierung einschalten"}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Das Budget gilt gemeinsam für beide Models pro deutschem Kalendertag. Reicht es nicht,
          wartet der Auftrag. Öffentliche Posts brauchen weiterhin deine Bestätigung.
        </p>
        {(p?.jobs ?? []).map(
          (j: { id: string; model: string; state: string; issue: string | null }) => (
            <p className="text-sm" key={j.id}>
              {j.model} ·{" "}
              {
                (
                  {
                    queued: "Wartet auf Server",
                    working: "Quelle wird vorbereitet",
                    budget_wait: "Wartet auf Tagesbudget",
                    reserved: "Generierung reserviert",
                    generating: "Video wird generiert",
                    review: "Zur Freigabe",
                    blocked: "Braucht Aufmerksamkeit",
                  } as Record<string, string>
                )[j.state]
              }
              {j.issue ? " · " + j.issue : ""}
            </p>
          ),
        )}
        <details>
          <summary>Server einrichten</summary>
          <p className="my-3 text-sm">
            Ein neuer Schlüssel ersetzt den bisherigen und pausiert die Verarbeitung. Nur in die
            geschützte Server-Konfiguration eintragen.
          </p>
          <Button disabled={busy} onClick={() => void act("pair")}>
            Neuen Server-Schlüssel erzeugen
          </Button>
          {token && (
            <>
              <textarea
                className="mt-3 w-full rounded border bg-background p-3"
                readOnly
                value={token}
                aria-label="Server-Schlüssel"
              />
              <Button variant="outline" onClick={() => setToken("")}>
                Schlüssel ausblenden
              </Button>
            </>
          )}
        </details>
        {(error || query.error) && (
          <p role="alert">{error || "Pipeline-Status nicht erreichbar."}</p>
        )}
      </div>
    </details>
  );
}
