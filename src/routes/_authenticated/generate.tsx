import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { generationSubmitFn } from "@/lib/generation.functions";
import { MAX_SOURCE_BYTES, type GenerationResult } from "@/lib/generation";
import { canonicalReel } from "@/lib/reel-inbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/generate")({ component: GeneratePage });
function GeneratePage() {
  const [model, setModel] = useState<"kiikii" | "tuuva" | null>(null);
  const [source, setSource] = useState<"link" | "file">("link");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState("");
  const [description, setDescription] = useState("");
  const [uploadId, setUploadId] = useState(() => crypto.randomUUID());
  const [uploaded, setUploaded] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [progress, setProgress] = useState("");
  const [check, setCheck] = useState<{ key: string; result?: GenerationResult; error?: string }>();
  const [retryCheck, setRetryCheck] = useState(0);
  const key = JSON.stringify([source, url, uploadId, model]);
  let reel: ReturnType<typeof canonicalReel> | undefined;
  try {
    if (source === "link" && url.trim()) reel = canonicalReel(url);
  } catch {
    /* Shown by preflight below. */
  }
  const character =
    model === "kiikii" ? "Kiikii" : model === "tuuva" ? "Tuuva" : "Charakter wählen";
  const fallbackTitle =
    source === "file" && file
      ? file.name.replace(/\.mp4$/i, "").replace(/[_-]+/g, " ")
      : "Instagram-Video";
  const title = character + " · " + (description.trim() || fallbackTitle);
  const hasSource = source === "link" ? !!url.trim() : !!file;
  const checked = check?.key === key ? check : undefined;
  const duplicates = checked?.result?.duplicates ?? [];

  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  useEffect(() => {
    let cancelled = false;
    setConfirmed(false);
    setCheck(undefined);
    if (!hasSource) return;
    const timer = setTimeout(async () => {
      try {
        let result: GenerationResult;
        if (source === "link") {
          const canonical = canonicalReel(url);
          result = await generationSubmitFn({ data: { action: "check_link", url: canonical.url } });
        } else {
          if (
            !file ||
            file.size < 12 ||
            file.size > MAX_SOURCE_BYTES ||
            !file.name.toLowerCase().endsWith(".mp4")
          )
            throw Error("Bitte eine MP4-Datei bis 40 MB auswählen.");
          const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
          const sha256 = Array.from(new Uint8Array(digest), (b) =>
            b.toString(16).padStart(2, "0"),
          ).join("");
          if (cancelled) return;
          result = await generationSubmitFn({ data: { action: "check_file", sha256 } });
        }
        if (!cancelled) setCheck({ key, result });
      } catch (error) {
        if (!cancelled)
          setCheck({
            key,
            error: error instanceof Error ? error.message : "Prüfung fehlgeschlagen.",
          });
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, retryCheck, file, hasSource, source, url]);

  const submit = useMutation({
    retry: false,
    mutationFn: async () => {
      if (!model || !checked?.result || (duplicates.length > 0 && !confirmed))
        throw Error("Bitte Vorlage prüfen und Charakter auswählen.");
      if (source === "link")
        return generationSubmitFn({
          data: { action: "link", model, url, duplicate_confirmed: confirmed },
        });
      if (!file) throw Error("Bitte ein Video auswählen.");
      if (!uploaded) {
        setProgress("Video wird hochgeladen …");
        const prepared = await generationSubmitFn({
          data: { action: "prepare", model, id: uploadId },
        });
        if (!prepared.path || !prepared.token) throw Error("Upload nicht vorbereitet.");
        const result = await supabase.storage
          .from("generation-sources")
          .uploadToSignedUrl(prepared.path, prepared.token, file, { contentType: "video/mp4" });
        if (result.error && !/already exists|duplicate/i.test(result.error.message))
          throw Error("Upload nicht bestätigt. Mit derselben Datei erneut versuchen.");
        setUploaded(true);
      }
      setProgress("Upload wird geprüft …");
      return generationSubmitFn({
        data: { action: "upload", model, id: uploadId, duplicate_confirmed: confirmed },
      });
    },
    onSuccess: (result) => {
      if (result.duplicate_warning) {
        setCheck({ key, result });
        setConfirmed(false);
      }
    },
    onSettled: () => setProgress(""),
  });
  const saved = !!submit.data?.id && !submit.data.duplicate_warning;
  const reset = () => {
    setConfirmed(false);
    submit.reset();
  };
  const resetUpload = () => {
    setUploadId(crypto.randomUUID());
    setUploaded(false);
    reset();
  };
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 md:p-6">
      <h1 className="text-3xl font-bold">Video erstellen</h1>
      <p className="text-muted-foreground">
        Vorlage prüfen. Charakter wählen. Ergebnis in Telegram ansehen.
      </p>
      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          submit.mutate();
        }}
      >
        <fieldset disabled={submit.isPending} className="space-y-3">
          <legend className="mb-3 text-xl font-semibold">1. Dein Ausgangsvideo</legend>
          <div className="grid grid-cols-2 gap-3">
            <Button
              type="button"
              className="h-14 text-base"
              variant={source === "link" ? "default" : "outline"}
              aria-pressed={source === "link"}
              onClick={() => {
                setSource("link");
                setDescription("");
                reset();
              }}
            >
              Instagram-Link
            </Button>
            <Button
              type="button"
              className="h-14 text-base"
              variant={source === "file" ? "default" : "outline"}
              aria-pressed={source === "file"}
              onClick={() => {
                setSource("file");
                setDescription("");
                reset();
              }}
            >
              Video hochladen
            </Button>
          </div>
          {source === "link" ? (
            <label className="grid gap-2">
              Link zum Reel
              <Input
                className="h-14"
                type="url"
                required
                value={url}
                placeholder="https://www.instagram.com/reel/…"
                onChange={(e) => {
                  setUrl(e.target.value);
                  setDescription("");
                  reset();
                }}
              />
            </label>
          ) : (
            <label className="grid gap-2 rounded-xl border p-4">
              MP4-Datei auswählen · maximal 40 MB
              <input
                className="min-h-14 w-full py-3"
                type="file"
                accept=".mp4,video/mp4"
                onChange={(e) => {
                  setFile(e.target.files?.[0]);
                  setDescription("");
                  resetUpload();
                }}
              />
              {file && <span className="break-all text-sm">{file.name}</span>}
            </label>
          )}
          <p className="text-sm text-muted-foreground">Hochformat 9:16, 2–15 Sekunden.</p>
        </fieldset>
        {hasSource && (
          <section aria-label="Vorschau" className="space-y-3 rounded-xl border p-4">
            {source === "file" && preview && (
              <video
                className="mx-auto max-h-96 w-full rounded-lg bg-black"
                src={preview}
                controls
                playsInline
                preload="metadata"
              />
            )}
            {source === "link" && reel && (
              <>
                <iframe
                  key={reel.shortcode}
                  title="Instagram-Vorschau"
                  src={"https://www.instagram.com/p/" + reel.shortcode + "/embed/"}
                  className="h-[440px] w-full rounded-lg border"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  allowFullScreen
                />
                <p className="text-sm text-muted-foreground">
                  Keine Vorschau? Private Beiträge oder Instagram können sie blockieren.{" "}
                  <a
                    href={reel.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    Original öffnen
                  </a>{" "}
                  oder Video hochladen.
                </p>
              </>
            )}
            <h2 className="break-words text-xl font-semibold">{title}</h2>
            <label className="grid gap-2 text-sm">
              Kurzbeschreibung für diese Vorschau (optional)
              <Input
                className="h-12"
                maxLength={100}
                value={description}
                disabled={submit.isPending}
                placeholder="z. B. Grünes Oberteil am Fenster"
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
          </section>
        )}
        <fieldset disabled={submit.isPending} className="space-y-3">
          <legend className="mb-3 text-xl font-semibold">2. Für wen?</legend>
          <div className="grid grid-cols-2 gap-3">
            {(["kiikii", "tuuva"] as const).map((value) => (
              <Button
                key={value}
                type="button"
                className={"h-20 text-xl " + (model === value ? "ring-4 ring-primary/30" : "")}
                variant={model === value ? "default" : "outline"}
                aria-pressed={model === value}
                onClick={() => {
                  if (model !== value) {
                    setModel(value);
                    resetUpload();
                  }
                }}
              >
                {model === value ? "✓ " : ""}
                {value === "kiikii" ? "Kiikii" : "Tuuva"}
              </Button>
            ))}
          </div>
          <p className="rounded-xl border-2 border-primary bg-primary/10 p-4 text-center text-xl font-bold">
            {model
              ? "Du erstellst ein Video für " + character
              : "Bitte Kiikii oder Tuuva auswählen"}
          </p>
        </fieldset>
        {hasSource && !checked && <p role="status">Vorlage wird auf Duplikate geprüft …</p>}
        {checked?.error && (
          <div role="alert" className="space-y-2 rounded-xl border border-destructive p-4">
            <p>{checked.error}</p>
            <Button type="button" variant="outline" onClick={() => setRetryCheck((v) => v + 1)}>
              Prüfung wiederholen
            </Button>
          </div>
        )}
        {duplicates.length > 0 && !saved && (
          <div
            role="alert"
            className="space-y-3 rounded-xl border-2 border-amber-500 bg-amber-500/10 p-4"
          >
            <h2 className="text-xl font-bold">Diese Vorlage wurde schon eingereicht</h2>
            <p>Treffer der letzten 30 Tage, auch beim anderen Charakter:</p>
            <ul className="space-y-1">
              {duplicates.slice(0, 3).map((d) => (
                <li key={d.id}>
                  {d.model === "kiikii" ? "Kiikii" : "Tuuva"} ·{" "}
                  {new Date(d.created_at).toLocaleDateString("de-DE")}
                </li>
              ))}
            </ul>
            <p>
              {source === "file"
                ? "Ein weiterer Upload kann später erneut Guthaben verbrauchen."
                : "Für denselben Charakter wird ein vorhandener Auftrag wieder geöffnet. Für den anderen Charakter kann ein neuer kostenpflichtiger Auftrag entstehen."}
            </p>
            <label className="flex min-h-14 cursor-pointer items-center gap-3 font-semibold">
              <input
                className="h-6 w-6"
                type="checkbox"
                checked={confirmed}
                disabled={submit.isPending}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              Ich habe den Hinweis gelesen und möchte fortfahren.
            </label>
          </div>
        )}
        {checked?.result?.enabled === false && (
          <p className="rounded-xl border p-4 font-semibold">
            Pipeline pausiert. Neue Aufträge warten.
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          Generierung verbraucht Guthaben. Diese Seite aktiviert die Pipeline nicht.
        </p>
        <Button
          className="h-16 w-full text-xl"
          type="submit"
          disabled={
            submit.isPending ||
            saved ||
            !model ||
            !checked?.result ||
            (duplicates.length > 0 && !confirmed)
          }
        >
          {submit.isPending ? progress || "Auftrag wird angelegt …" : "Video erstellen"}
        </Button>
      </form>
      {submit.isError && (
        <p role="alert" className="rounded-xl border border-destructive p-4">
          {submit.error.message}
        </p>
      )}
      {saved && (
        <div role="status" className="space-y-3 rounded-xl border p-5">
          <h2 className="text-xl font-semibold">Auftrag gespeichert</h2>
          <p>
            {submit.data?.enabled
              ? "Das Ergebnis kommt zur Prüfung in Telegram."
              : "Die Pipeline ist pausiert. Dein Auftrag wartet."}
          </p>
          <p className="break-all text-sm text-muted-foreground">
            Auftrag: {submit.data?.id} · Status: {submit.data?.state}
          </p>
          <Link to="/content-review" className="inline-flex min-h-12 items-center underline">
            Zur Video-Prüfung
          </Link>
        </div>
      )}
    </div>
  );
}
