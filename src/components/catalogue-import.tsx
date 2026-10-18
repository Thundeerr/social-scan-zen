import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { catalogueImportFn } from "@/lib/catalogue-import.functions";
import { Button } from "@/components/ui/button";

export function CatalogueImport({ userId }: { userId: string }) {
  const cache = useQueryClient();
  const [videos, setVideos] = useState("");
  const [offers, setOffers] = useState("");
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const mutation = useMutation({
    mutationFn: catalogueImportFn,
    onSuccess: (report) => {
      if (!report.preview) void cache.invalidateQueries({ queryKey: ["content-catalogue", userId] });
    },
  });
  const busy = reading || mutation.isPending;
  async function read(file: File | undefined, kind: "videos" | "offers") {
    mutation.reset(); setError(""); setReading(true);
    const set = kind === "videos" ? setVideos : setOffers;
    set("");
    try {
      if (!file) return;
      if (file.size > 1000000) throw new Error("Die Datei darf höchstens 1 MB groß sein.");
      set(await file.text());
    } catch (e) { setError(e instanceof Error ? e.message : "Datei konnte nicht gelesen werden."); }
    finally { setReading(false); }
  }
  return <details className="rounded-xl border p-4">
    <summary className="cursor-pointer py-3 font-semibold">Alte Desktop-Dateien importieren</summary>
    <div className="mt-3 space-y-4">
      <p>Erst prüfen, dann übernehmen. Bestehende Videos werden nicht überschrieben. Es wird nichts veröffentlicht.</p>
      <label className="grid gap-2">1. VIDEO REGISTER.json
        <input type="file" accept=".json,application/json" disabled={busy}
          onChange={e => void read(e.target.files?.[0], "videos")} />
      </label>
      <label className="grid gap-2">2. OFFER REGISTER.json
        <input type="file" accept=".json,application/json" disabled={busy}
          onChange={e => void read(e.target.files?.[0], "offers")} />
      </label>
      <Button className="h-14 w-full text-lg" disabled={busy || !videos || !offers}
        onClick={() => mutation.mutate({ data: { videos, offers, preview: true } })}>
        {mutation.isPending ? "Wird geprüft …" : "Dateien prüfen – noch nichts speichern"}
      </Button>
      {(error || mutation.isError) && <p role="alert">{error || mutation.error?.message}</p>}
      {mutation.data && <div role="status" className="space-y-3 rounded-lg bg-muted p-4">
        <p className="font-semibold">{mutation.data.preview ? "Vorschau – noch nichts gespeichert" : "Import abgeschlossen"}</p>
        <p>{mutation.data.added} {mutation.data.preview ? "neue" : "gespeicherte"} Datensätze · {mutation.data.existing} bereits vorhanden · {mutation.data.skipped} übersprungen</p>
        <p className="text-sm">Gezählt werden Videos, Bundles, Bundle-Zuordnungen und Empfänger. Historische Handles sind keine verifizierten Fan-IDs.</p>
        {mutation.data.issues.length > 0 && <details><summary className="cursor-pointer py-3">Hinweise ansehen ({mutation.data.issues.length})</summary>
          <ul className="space-y-2">{mutation.data.issues.map((issue, i) => <li key={i}>{issue.item}: {issue.reason}</li>)}</ul>
        </details>}
        <Button variant="outline" className="w-full" onClick={() => {
          const url = URL.createObjectURL(new Blob([JSON.stringify(mutation.data, null, 2)], { type: "application/json" }));
          const a = document.createElement("a"); a.href = url; a.download = "catalogue-import-report.json"; a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}>Bericht herunterladen</Button>
        {mutation.data.preview && <Button className="h-14 w-full text-lg" disabled={busy}
          onClick={() => mutation.mutate({ data: { videos, offers, preview: false } })}>Jetzt übernehmen – Konflikte überspringen</Button>}
      </div>}
    </div>
  </details>;
}
