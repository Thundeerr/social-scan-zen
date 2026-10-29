import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { ArrowDown, Check, Clapperboard, Play, Send, Settings2 } from "lucide-react";
import { contentReviewFn } from "@/lib/content-review.functions";
import { models, MAX_REVIEW_BYTES, type ReviewItem, type ReviewAction } from "@/lib/content-review";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ChannelAlerts } from "@/components/channel-alerts";
import { ModelPublish } from "@/components/model-publish";
import { ModelPipeline } from "@/components/model-pipeline";
import { CopyVideoButton } from "@/components/copy-video-button";
import { reviewVideoReference } from "@/lib/video-source";

export const Route = createFileRoute("/_authenticated/content-review")({
  validateSearch: z.object({ item: z.string().uuid().optional().catch(undefined) }),
  component: ContentReview,
});
const labels = {
  uploading: "Upload pending",
  pending: "Needs approval",
  approved: "Approved",
  rejected: "Rejected",
  changes: "Changes requested",
};
const notifyLabels = {
  none: "Not sent yet",
  sending: "Sending started — check the bot",
  sent: "In the review bot",
  uncertain: "Delivery unclear — check the bot",
};
const statusStyles: Record<ReviewItem["status"], string> = {
  uploading: "border-border bg-muted text-muted-foreground",
  pending: "border-amber-400/25 bg-amber-400/10 text-amber-200",
  approved: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200",
  rejected: "border-rose-400/25 bg-rose-400/10 text-rose-200",
  changes: "border-primary/30 bg-primary/10 text-primary",
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
      setMessage(error instanceof Error ? error.message : "Action failed.");
      return null;
    } finally {
      await cache.invalidateQueries({ queryKey: key });
      setBusy(false);
    }
  }
  async function upload() {
    if (!file || file.size > MAX_REVIEW_BYTES || !file.name.toLowerCase().endsWith(".mp4")) {
      setMessage("Choose an MP4 video up to 40 MB.");
      return;
    }
    setBusy(true);
    setMessage("Uploading and checking your video …");
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
      if (error) throw new Error("Upload failed. The pending item remains visible.");
      await contentReviewFn({ data: { action: "finalize", id: item.id, revision: item.revision } });
      setTitle("");
      setCaption("");
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      setMessage("Video saved. Check the preview and caption next.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      await cache.invalidateQueries({ queryKey: key });
      setBusy(false);
    }
  }
  const items = (query.data?.items ?? []).filter((i) => filter === "all" || i.model === filter);
  const sorted = [...items].sort((a, b) => Number(b.id === focus) - Number(a.id === focus));
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <header className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            Your content
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Review reels</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Watch the video, check the caption, then approve. Publishing is a separate step.
          </p>
        </div>
        <a
          href="#review-settings"
          className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-medium transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Settings2 className="h-4 w-4" />
          Connections & pipeline
          <ArrowDown className="h-4 w-4 text-muted-foreground" />
        </a>
      </header>
      {message && (
        <p
          role="status"
          className="sticky top-20 z-20 rounded-xl border border-primary/30 bg-card p-4 text-sm shadow-lg"
        >
          {message}
        </p>
      )}
      {query.error && (
        <p
          role="alert"
          className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm"
        >
          Could not load reviews. Sign in again or try later.
        </p>
      )}
      <section
        className="rounded-2xl border border-border bg-card p-4 md:p-5"
        aria-label="Filter reels"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap gap-2">
            {[["all", "All"], ...Object.entries(models)].map(([id, name]) => (
              <Button
                key={id}
                className="min-h-12 min-w-24 rounded-xl text-sm"
                aria-pressed={filter === id}
                variant={filter === id ? "default" : "outline"}
                onClick={() => setFilter(id)}
              >
                {name}
              </Button>
            ))}
          </div>
          {query.isSuccess && (
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">
                {items.filter((item) => item.status === "pending").length}
              </span>{" "}
              awaiting approval
              <span className="mx-2 text-border">/</span>
              {items.length} loaded
            </p>
          )}
        </div>
        {query.isSuccess && (
          <p className="mt-4 flex items-start gap-2 border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
            <Send className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {query.data?.telegramReady
              ? "Telegram connected. You can also send reels to your private review chat."
              : "You can approve here. The Telegram review bot connection is not fully set up yet."}
          </p>
        )}
      </section>
      {query.isPending && (
        <p
          role="status"
          className="rounded-2xl border border-dashed p-8 text-center text-muted-foreground"
        >
          Loading your reels …
        </p>
      )}
      {query.isSuccess && !items.length && (
        <div className="rounded-2xl border border-dashed p-10 text-center">
          <Clapperboard className="mx-auto mb-3 h-8 w-8 text-primary" />
          <p className="font-medium">No reels here yet.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Your completed videos will appear here for review.
          </p>
        </div>
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
        Latest 100 items. FanWake messages stay in the existing bot chat.
      </p>
      <section
        id="review-settings"
        className="scroll-mt-24 space-y-4 border-t border-border pt-8"
        aria-labelledby="review-settings-title"
      >
        <div>
          <h2 id="review-settings-title" className="text-lg font-semibold">
            Connections & pipeline
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage Instagram, Telegram and video processing.
          </p>
        </div>
        <ChannelAlerts userId={user.id} />
        <ModelPipeline />
        <details className="rounded-xl border bg-card p-4">
          <summary className="min-h-8 cursor-pointer font-medium">
            Upload your own video for review
          </summary>
          <div className="mt-4 grid gap-3">
            <label className="grid gap-2 text-sm font-medium">
              Character
              <select
                aria-label="Model for new reel"
                value={model}
                onChange={(e) => setModel(e.target.value as keyof typeof models)}
                className="min-h-12 rounded-lg border bg-background p-3"
              >
                {Object.entries(models).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <Input
              className="min-h-12"
              aria-label="Reel title"
              placeholder="Title"
              value={title}
              maxLength={160}
              onChange={(e) => setTitle(e.target.value)}
            />
            <Textarea
              aria-label="New caption"
              placeholder="Caption including hashtags"
              maxLength={2200}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
            />
            <Input
              className="min-h-12"
              ref={fileInput}
              aria-label="MP4 video"
              type="file"
              accept="video/mp4,.mp4"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <Button
              className="min-h-12"
              disabled={busy || !file || !title.trim()}
              onClick={() => void upload()}
            >
              Upload video
            </Button>
          </div>
        </details>
      </section>
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
      className={`overflow-hidden rounded-2xl border bg-card p-4 space-y-5 md:p-6 ${focused ? "border-primary ring-2 ring-primary/20" : "border-border"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">
            {models[item.model]} · Version {item.revision}
          </p>
          <h2 className="mt-1 break-words text-lg font-semibold">{item.title}</h2>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${statusStyles[item.status]}`}
        >
          {item.status === "approved" && <Check className="h-3.5 w-3.5" />}
          {labels[item.status]}
        </span>
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="min-w-0 space-y-3">
          {url && (
            <video
              className="mx-auto max-h-[65vh] w-full rounded-xl bg-black object-contain"
              controls
              playsInline
              preload="metadata"
              src={url}
            />
          )}
          {item.status === "uploading" ? (
            <Button
              className="min-h-14 w-full whitespace-normal rounded-xl px-4"
              disabled={busy}
              variant="outline"
              onClick={() => void run({ action: "finalize", ...base })}
            >
              Check uploaded video
            </Button>
          ) : (
            <Button
              className="min-h-14 w-full whitespace-normal rounded-xl border-primary/30 bg-primary/5 px-4 text-primary hover:bg-primary/10"
              disabled={busy}
              variant="outline"
              onClick={async () => {
                const result = await run({ action: "preview", ...base });
                if (result?.url) setUrl(result.url);
              }}
            >
              <Play className="h-4 w-4" />
              {url ? "Refresh preview" : "Watch video"}
            </Button>
          )}
          {item.status !== "uploading" && (
            <CopyVideoButton reference={reviewVideoReference(item.id, item.revision)} />
          )}
          <p className="text-xs leading-relaxed text-muted-foreground">
            {notifyLabels[item.notification]} ·{" "}
            {item.bytes ? (item.bytes / 1048576).toFixed(1) + " MB" : "Upload pending"}
          </p>
        </div>
        <div className="min-w-0 space-y-4">
          <label className="block text-sm font-medium">
            Caption & Hashtags
            <Textarea
              className="mt-2 min-h-28 rounded-xl bg-background/60 text-sm font-normal leading-relaxed"
              value={caption}
              maxLength={2200}
              disabled={!!item.publish_post_id}
              onChange={(e) => setCaption(e.target.value)}
            />
          </label>
          {dirty && (
            <Button
              className="min-h-12 w-full whitespace-normal rounded-xl"
              disabled={busy || item.status === "uploading"}
              onClick={() => void run({ action: "edit", ...base, caption })}
            >
              Save caption · approval required again
            </Button>
          )}
          {item.status === "pending" && (
            <>
              <Textarea
                className="min-h-20 rounded-xl bg-background/60"
                aria-label="Requested change"
                placeholder="Requested change / note"
                maxLength={2000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <Button
                  className="min-h-12 whitespace-normal rounded-xl px-3"
                  disabled={busy || dirty || !caption.trim()}
                  onClick={() =>
                    void run({ action: "decide", ...base, decision: "approved", note })
                  }
                >
                  <Check className="h-4 w-4" />
                  Approve
                </Button>
                <Button
                  className="min-h-12 whitespace-normal rounded-xl px-3"
                  variant="outline"
                  disabled={busy || dirty || !note.trim()}
                  onClick={() => void run({ action: "decide", ...base, decision: "changes", note })}
                >
                  Request changes
                </Button>
                <Button
                  className="min-h-12 whitespace-normal rounded-xl px-3"
                  variant="outline"
                  disabled={busy || dirty}
                  onClick={() =>
                    void run({ action: "decide", ...base, decision: "rejected", note })
                  }
                >
                  Reject
                </Button>
                <Button
                  className="min-h-12 whitespace-normal rounded-xl px-3"
                  variant="outline"
                  disabled={busy || dirty || !telegramReady || item.notification !== "none"}
                  onClick={() => void run({ action: "notify", ...base })}
                >
                  Send to review bot
                </Button>
              </div>
            </>
          )}
          {item.note && (
            <p className="whitespace-pre-wrap rounded-xl bg-muted/50 p-3 text-sm leading-relaxed">
              {item.note}
            </p>
          )}
          {item.telegram_message_id && (
            <Button
              className="min-h-12 w-full whitespace-normal rounded-xl"
              variant="outline"
              disabled={busy || !telegramReady}
              onClick={() => void run({ action: "refresh_card", ...base })}
            >
              Refresh Telegram buttons
            </Button>
          )}
          {(item.status === "approved" || item.publish_post_id) && (
            <ModelPublish item={item} dirty={dirty} />
          )}
        </div>
      </div>
    </article>
  );
}
