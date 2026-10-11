import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { contentReviewFn } from "@/lib/content-review.functions";
import { models, MAX_REVIEW_BYTES, type ReviewItem, type ReviewAction } from "@/lib/content-review";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ChannelAlerts } from "@/components/channel-alerts";
import { ModelPublish } from "@/components/model-publish";

export const Route = createFileRoute("/_authenticated/content-review")({
  validateSearch: z.object({ item: z.string().uuid().optional().catch(undefined) }),
  component: ContentReview,
});
const labels = {
  uploading: "Upload offen",
  pending: "Braucht Freigabe",
  approved: "Freigegeben",
  rejected: "Abgelehnt",
  changes: "Änderungen gewünscht",
};
const notifyLabels = {
  none: "Noch nicht gesendet",
  sending: "Versand gestartet – Bot prüfen",
  sent: "Im Review-Bot",
  uncertain: "Versand unklar – Bot prüfen",
};

function ContentReview() {
  const { user } = Route.useRouteContext();
  const { item: focus } = Route.useSearch();
  const cache = useQueryClient();
  const [filter, setFilter] = useState("all");
  const [model, setModel] = useState<keyof typeof models>("tuuva");
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const key = ["content-review", user.id];
  const query = useQuery({
    queryKey: key,
    queryFn: () => contentReviewFn({ data: { action: "list" } }),
    refetchInterval: 30000,
  });
  async function run(action: ReviewAction) {
    setBusy(true);
    setMessage("");
    try {
      const result = await contentReviewFn({ data: action });
      await cache.invalidateQueries({ queryKey: key });
      return result;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Aktion fehlgeschlagen.");
      return null;
    } finally {
      await cache.invalidateQueries({ queryKey: key });
      setBusy(false);
    }
  }
  async function upload() {
    if (!file || file.size > MAX_REVIEW_BYTES || !file.name.toLowerCase().endsWith(".mp4")) {
      setMessage("Bitte ein MP4-Video bis 40 MB auswählen.");
      return;
    }
    setBusy(true);
    setMessage("Video wird hochgeladen und geprüft …");
    try {
      const created = await contentReviewFn({ data: { action: "create", model, title, caption } });
      const item = created.item!;
      const upload = await contentReviewFn({
        data: { action: "upload", id: item.id, revision: item.revision },
      });
      const { error } = await supabase.storage
        .from("content-review")
        .uploadToSignedUrl(upload.path!, upload.token!, file, {
          contentType: "video/mp4",
          upsert: false,
        });
      if (error) throw new Error("Upload fehlgeschlagen. Der offene Eintrag bleibt sichtbar.");
      await contentReviewFn({ data: { action: "finalize", id: item.id, revision: item.revision } });
      setTitle("");
      setCaption("");
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      setMessage("Video gespeichert. Jetzt Vorschau und Caption prüfen.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload fehlgeschlagen.");
    } finally {
      await cache.invalidateQueries({ queryKey: key });
      setBusy(false);
    }
  }
  const items = (query.data?.items ?? []).filter((i) => filter === "all" || i.model === filter);
  const sorted = [...items].sort((a, b) => Number(b.id === focus) - Number(a.id === focus));
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-semibold">Content Review</h1>
        <p className="mt-2 text-muted-foreground">
          Kiikii & Tuuva · Video und Caption gemeinsam freigeben. Veröffentlichen bleibt ein eigener
          Schritt.
        </p>
      </header>
      <div className="rounded-xl border bg-card p-4 text-sm">
        {query.data?.telegramReady
          ? "Review-Bot verbunden. Karten werden nur an deinen privaten Chat gesendet."
          : "Freigaben in InstaScanner. Die Verbindung zum gemeinsamen Review-Bot ist noch nicht vollständig eingerichtet."}
      </div>
      <ChannelAlerts userId={user.id} />
      <details className="rounded-xl border bg-card p-4">
        <summary className="cursor-pointer font-medium">Reel zur Freigabe hinzufügen</summary>
        <div className="mt-4 grid gap-3">
          <label>
            Model
            <select
              aria-label="Model für neues Reel"
              value={model}
              onChange={(e) => setModel(e.target.value as keyof typeof models)}
              className="ml-3 rounded border bg-background p-2"
            >
              {Object.entries(models).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <Input
            aria-label="Reel-Titel"
            placeholder="Titel"
            value={title}
            maxLength={160}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Textarea
            aria-label="Neue Caption"
            placeholder="Caption inklusive Hashtags"
            maxLength={2200}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
          />
          <Input
            ref={fileInput}
            aria-label="MP4-Video"
            type="file"
            accept="video/mp4,.mp4"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <Button disabled={busy || !file || !title.trim()} onClick={() => void upload()}>
            Hochladen
          </Button>
        </div>
      </details>
      {message && (
        <p role="status" className="rounded border p-3 text-sm">
          {message}
        </p>
      )}
      {query.error && (
        <p role="alert">
          Freigaben konnten nicht geladen werden. Bitte erneut anmelden oder später versuchen.
        </p>
      )}
      <div className="flex gap-2">
        {[["all", "Alle Models"], ...Object.entries(models)].map(([id, name]) => (
          <Button
            key={id}
            variant={filter === id ? "default" : "outline"}
            onClick={() => setFilter(id)}
          >
            {name}
          </Button>
        ))}
      </div>
      {query.isPending && <p>Lade Freigaben …</p>}
      {query.isSuccess && !items.length && (
        <p className="text-muted-foreground">Hier erscheinen deine nächsten Reels zur Freigabe.</p>
      )}
      {sorted.map((item) => (
        <ReviewCard
          key={item.id + ":" + item.revision}
          item={item}
          focused={item.id === focus}
          busy={busy}
          telegramReady={!!query.data?.telegramReady}
          run={run}
        />
      ))}
      <p className="text-xs text-muted-foreground">
        Letzte 100 Einträge. FanWake-Nachrichten bleiben im bestehenden Bot-Chat.
      </p>
    </div>
  );
}

function ReviewCard({
  item,
  focused,
  busy,
  telegramReady,
  run,
}: {
  item: ReviewItem;
  focused: boolean;
  busy: boolean;
  telegramReady: boolean;
  run: (a: ReviewAction) => Promise<import("@/lib/content-review").ReviewResult | null>;
}) {
  const [url, setUrl] = useState("");
  const [caption, setCaption] = useState(item.caption);
  const [note, setNote] = useState("");
  const dirty = caption !== item.caption;
  const base = { id: item.id, revision: item.revision };
  return (
    <article
      className={`rounded-xl border bg-card p-4 space-y-4 ${focused ? "border-primary" : ""}`}
    >
      <div className="flex flex-wrap justify-between gap-2">
        <div>
          <p className="text-sm text-muted-foreground">
            {models[item.model]} · Version {item.revision}
          </p>
          <h2 className="font-semibold">{item.title}</h2>
        </div>
        <span className="text-sm">{labels[item.status]}</span>
      </div>
      {url && (
        <video
          className="mx-auto max-h-[60vh] max-w-full rounded-lg"
          controls
          playsInline
          preload="metadata"
          src={url}
        />
      )}
      {item.status === "uploading" ? (
        <Button
          disabled={busy}
          variant="outline"
          onClick={() => void run({ action: "finalize", ...base })}
        >
          Bereits hochgeladenes Video prüfen
        </Button>
      ) : (
        <Button
          disabled={busy}
          variant="outline"
          onClick={async () => {
            const result = await run({ action: "preview", ...base });
            if (result?.url) setUrl(result.url);
          }}
        >
          Vorschau laden / erneuern
        </Button>
      )}
      <label className="block text-sm">
        Caption & Hashtags
        <Textarea
          className="mt-2"
          value={caption}
          maxLength={2200}
          disabled={!!item.publish_post_id}
          onChange={(e) => setCaption(e.target.value)}
        />
      </label>
      {dirty && (
        <Button
          disabled={busy || item.status === "uploading"}
          onClick={() => void run({ action: "edit", ...base, caption })}
        >
          Caption speichern · neue Freigabe nötig
        </Button>
      )}
      {item.status === "pending" && (
        <>
          <Textarea
            aria-label="Änderungswunsch"
            placeholder="Änderungswunsch / Notiz"
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || dirty || !caption.trim()}
              onClick={() => void run({ action: "decide", ...base, decision: "approved", note })}
            >
              Freigeben
            </Button>
            <Button
              variant="outline"
              disabled={busy || dirty || !note.trim()}
              onClick={() => void run({ action: "decide", ...base, decision: "changes", note })}
            >
              Änderung wünschen
            </Button>
            <Button
              variant="outline"
              disabled={busy || dirty}
              onClick={() => void run({ action: "decide", ...base, decision: "rejected", note })}
            >
              Ablehnen
            </Button>
            <Button
              variant="outline"
              disabled={busy || dirty || !telegramReady || item.notification !== "none"}
              onClick={() => void run({ action: "notify", ...base })}
            >
              An Review-Bot senden
            </Button>
          </div>
        </>
      )}
      {item.note && <p className="whitespace-pre-wrap text-sm">{item.note}</p>}
      {item.telegram_message_id && (
        <Button
          variant="outline"
          disabled={busy || !telegramReady}
          onClick={() => void run({ action: "refresh_card", ...base })}
        >
          Telegram-Buttons aktualisieren
        </Button>
      )}
      {(item.status === "approved" || item.publish_post_id) && (
        <ModelPublish item={item} dirty={dirty} />
      )}
      <p className="text-xs text-muted-foreground">
        {notifyLabels[item.notification]} ·{" "}
        {item.bytes ? (item.bytes / 1048576).toFixed(1) + " MB" : "Upload ausstehend"}
      </p>
    </article>
  );
}
