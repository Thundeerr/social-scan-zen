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
  const [promptId, setPromptId] = useState<"prompt_1" | "prompt_2" | null>(null);
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
      if (!model || !promptId || !checked?.result || (duplicates.length > 0 && !confirmed))
        throw Error("Bitte Vorlage prüfen und Charakter auswählen.");
      if (source === "link")
        return generationSubmitFn({
          data: { action: "link", model, url, prompt_id: promptId, duplicate_confirmed: confirmed },
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
        data: {
          action: "upload",
          model,
          id: uploadId,
          prompt_id: promptId,
          duplicate_confirmed: confirmed,
        },
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
  const chooseFile = (next?: File) => {
    setFile(next);
    setSource("file");
    setUrl("");
    resetUpload();
  };
  return (
    <div className="mx-auto max-w-xl space-y-5 p-4 md:p-6">
      <h1 className="text-3xl font-bold">Video erstellen</h1>
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit.mutate();
        }}
      >
        <fieldset disabled={submit.isPending} className="space-y-3">
          <legend className="sr-only">Ausgangsvideo</legend>
          <label
            className="flex min-h-44 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-primary bg-primary/5 p-6 text-center focus-within:ring-4 focus-within:ring-primary/30"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (!submit.isPending && e.dataTransfer.files.length)
                chooseFile(e.dataTransfer.files[0]);
            }}
          >
            <span className="text-2xl font-bold">{file ? file.name : "Video hier ablegen"}</span>
            <span className="text-sm text-muted-foreground">
              oder Datei auswählen · MP4 bis 40 MB
            </span>
            <input
              className="sr-only"
              type="file"
              accept=".mp4,video/mp4"
              onChange={(e) => chooseFile(e.target.files?.[0])}
            />
          </label>
          <Input
            aria-label="Instagram-Link"
            className="h-14"
            type="url"
            value={url}
            placeholder="Oder Instagram-Link einfügen"
            onChange={(e) => {
              setUrl(e.target.value);
              setFile(undefined);
              setSource("link");
              resetUpload();
            }}
          />
          {source === "file" && preview && (
            <video
              className="mx-auto max-h-56 w-full rounded-xl bg-black"
              src={preview}
              controls
              playsInline
              preload="metadata"
            />
          )}
          {source === "link" && reel && (
            <details className="rounded-xl border p-3">
              <summary className="cursor-pointer">Vorschau ansehen</summary>
              <iframe
                title="Instagram-Vorschau"
                src={"https://www.instagram.com/p/" + reel.shortcode + "/embed/"}
                className="mt-3 h-80 w-full rounded-lg border"
                loading="lazy"
                referrerPolicy="no-referrer"
                allowFullScreen
              />
              <a
                href={reel.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block py-3 underline"
              >
                Original öffnen
              </a>
            </details>
          )}
          <label className="flex items-center gap-3 text-sm">
            Charakter
            <select
              className="h-12 flex-1 rounded-lg border bg-background px-3 text-base"
              value={model ?? ""}
              onChange={(e) => {
                setModel((e.target.value as "kiikii" | "tuuva") || null);
                resetUpload();
              }}
            >
              <option value="" disabled>
                Bitte auswählen
              </option>
              <option value="kiikii">Kiikii</option>
              <option value="tuuva">Tuuva</option>
            </select>
          </label>
        </fieldset>
        <fieldset disabled={submit.isPending} className="grid grid-cols-2 gap-3">
          <legend className="sr-only">Prompt auswählen</legend>
          {(["prompt_1", "prompt_2"] as const).map((value, index) => (
            <Button
              key={value}
              type="button"
              className="h-24 text-2xl"
              variant={promptId === value ? "default" : "outline"}
              aria-pressed={promptId === value}
              onClick={() => {
                setPromptId(value);
                reset();
              }}
            >
              {promptId === value ? "✓ " : ""}Prompt {index + 1}
            </Button>
          ))}
        </fieldset>
        {hasSource && !checked && <p role="status">Vorlage wird geprüft …</p>}
        {checked?.error && (
          <div role="alert" className="rounded-xl border border-destructive p-4">
            <p>{checked.error}</p>
            <Button type="button" variant="outline" onClick={() => setRetryCheck((v) => v + 1)}>
              Erneut prüfen
            </Button>
          </div>
        )}
        {!!duplicates.length && !saved && (
          <div role="alert" className="space-y-3 rounded-xl border-2 border-amber-500 p-4">
            <p className="font-bold">Diese Vorlage wurde schon eingereicht.</p>
            <p className="text-sm">
              {source === "link"
                ? "Ein vorhandener Auftrag behält seinen bisherigen Prompt."
                : "Ein weiterer Upload kann erneut Guthaben verbrauchen."}
            </p>
            <label className="flex min-h-12 items-center gap-3">
              <input
                type="checkbox"
                className="h-6 w-6"
                checked={confirmed}
                disabled={submit.isPending}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              Verstanden, fortfahren
            </label>
          </div>
        )}
        <Button
          className="h-20 w-full text-2xl"
          type="submit"
          disabled={
            submit.isPending ||
            saved ||
            !model ||
            !promptId ||
            !checked?.result ||
            (!!duplicates.length && !confirmed)
          }
        >
          {submit.isPending ? progress || "Wird gespeichert …" : "Video erstellen"}
        </Button>
        <p className="text-sm text-muted-foreground">
          {checked?.result?.enabled === false ? "Pipeline pausiert. Dein Auftrag wartet. " : ""}
          Generierung verbraucht Guthaben.
        </p>
      </form>
      {submit.isError && (
        <p role="alert" className="rounded-xl border border-destructive p-4">
          {submit.error.message}
        </p>
      )}
      {saved && (
        <div role="status" className="space-y-2 rounded-xl border p-4">
          <p className="text-xl font-bold">Auftrag gespeichert · {character}</p>
          <Link to="/content-review" className="inline-flex min-h-12 items-center underline">
            Zur Video-Prüfung
          </Link>
        </div>
      )}
    </div>
  );
}
