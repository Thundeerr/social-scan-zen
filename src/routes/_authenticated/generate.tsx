import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { generationSubmitFn } from "@/lib/generation.functions";
import { MAX_SOURCE_BYTES } from "@/lib/generation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/generate")({ component: GeneratePage });
function GeneratePage() {
  const [model, setModel] = useState<"kiikii" | "tuuva">("kiikii");
  const [source, setSource] = useState<"link" | "file">("link");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File>();
  const [uploadId, setUploadId] = useState(() => crypto.randomUUID());
  const [uploaded, setUploaded] = useState(false);
  const [progress, setProgress] = useState("");
  const submit = useMutation({
    retry: false,
    mutationFn: async () => {
      if (source === "link") return generationSubmitFn({ data: { action: "link", model, url } });
      if (!file || file.size < 12 || file.size > MAX_SOURCE_BYTES || !file.name.toLowerCase().endsWith(".mp4"))
        throw Error("Bitte eine MP4-Datei bis 40 MB auswählen.");
      if (!uploaded) {
        setProgress("Video wird hochgeladen …");
        const prepared = await generationSubmitFn({ data: { action: "prepare", model, id: uploadId } });
        if (!prepared.path || !prepared.token) throw Error("Upload nicht vorbereitet.");
        const result = await supabase.storage.from("generation-sources").uploadToSignedUrl(
          prepared.path, prepared.token, file, { contentType: "video/mp4" });
        // A previous upload may have succeeded despite a lost response. Finalization
        // verifies the stored bytes and reuses the same request ID instead of billing twice.
        if (result.error && !/already exists|duplicate/i.test(result.error.message)) throw Error("Upload nicht bestätigt. Mit derselben Datei erneut versuchen.");
        setUploaded(true);
      }
      setProgress("Upload wird geprüft …");
      return generationSubmitFn({ data: { action: "upload", model, id: uploadId } });
    },
    onSettled: () => setProgress(""),
  });
  const resetUpload = () => { setUploadId(crypto.randomUUID()); setUploaded(false); submit.reset(); };
  return <div className="mx-auto max-w-2xl space-y-6 p-4 md:p-6">
    <h1 className="text-3xl font-bold">Video erstellen</h1>
    <p className="text-muted-foreground">Vorlage auswählen. Charakter wählen. Ergebnis in Telegram prüfen.</p>
    <form className="space-y-6" onSubmit={e => { e.preventDefault(); submit.mutate(); }}>
      <fieldset disabled={submit.isPending} className="space-y-3">
        <legend className="mb-3 text-xl font-semibold">1. Dein Ausgangsvideo</legend>
        <div className="grid grid-cols-2 gap-3">
          <Button type="button" className="h-14 text-base" variant={source === "link" ? "default" : "outline"}
            aria-pressed={source === "link"} onClick={() => { setSource("link"); submit.reset(); }}>Instagram-Link</Button>
          <Button type="button" className="h-14 text-base" variant={source === "file" ? "default" : "outline"}
            aria-pressed={source === "file"} onClick={() => { setSource("file"); submit.reset(); }}>Video hochladen</Button>
        </div>
        {source === "link" ? <label className="grid gap-2">Link zum Reel
          <Input className="h-14" type="url" required value={url} placeholder="https://www.instagram.com/reel/…"
            onChange={e => { setUrl(e.target.value); submit.reset(); }} />
        </label> : <label className="grid gap-2 rounded-xl border p-4">MP4-Datei auswählen · maximal 40 MB
          <input className="min-h-14 w-full py-3" type="file" accept=".mp4,video/mp4" required
            onChange={e => { setFile(e.target.files?.[0]); resetUpload(); }} />
        </label>}
        <p className="text-sm text-muted-foreground">Hochformat 9:16, 2–15 Sekunden. Andere Webseiten werden derzeit nicht unterstützt.</p>
      </fieldset>
      <fieldset disabled={submit.isPending} className="space-y-3">
        <legend className="mb-3 text-xl font-semibold">2. Für wen?</legend>
        <div className="grid grid-cols-2 gap-3">
          {(["kiikii", "tuuva"] as const).map(value => <Button key={value} type="button"
            className="h-16 text-xl" variant={model === value ? "default" : "outline"}
            aria-pressed={model === value} onClick={() => { if (model !== value) { setModel(value); resetUpload(); } }}>
            {value === "kiikii" ? "Kiikii" : "Tuuva"}
          </Button>)}
        </div>
      </fieldset>
      <p className="text-sm text-muted-foreground">Die Generierung verbraucht Guthaben innerhalb deines bestehenden Tageslimits. Eine pausierte Pipeline bleibt pausiert.</p>
      <Button className="h-16 w-full text-xl" type="submit"
        disabled={submit.isPending || submit.isSuccess || (source === "link" ? !url.trim() : !file)}>
        {submit.isPending ? progress || "Auftrag wird angelegt …" : "Video erstellen"}
      </Button>
    </form>
    {submit.isError && <p role="alert" className="rounded-xl border border-destructive p-4">{submit.error.message}</p>}
    {submit.data && <div role="status" className="space-y-3 rounded-xl border p-5">
      <h2 className="text-xl font-semibold">Auftrag gespeichert</h2>
      <p>{submit.data.enabled ? "Der Worker übernimmt den Auftrag. Das Ergebnis kommt zur Prüfung in Telegram." : "Die Pipeline ist pausiert. Dein Auftrag wartet, bis sie wieder aktiviert wird."}</p>
      <p className="break-all text-sm text-muted-foreground">Auftrag: {submit.data.id} · Status: {submit.data.state}</p>
      <Link to="/content-review" className="inline-flex min-h-12 items-center underline">Zur Video-Prüfung</Link>
    </div>}
  </div>;
}
