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
      setError(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="min-w-0 space-y-3 rounded-lg border p-3 [&_button]:min-h-12 [&_button]:max-w-full [&_button]:whitespace-normal [&_button]:break-words">
      <h3 className="font-medium">Publish to Instagram</h3>
      <p className="text-sm">
        {p?.username
          ? `Destination: @${p.username} · ${models[item.model]}`
          : `Connect ${models[item.model]} to Instagram in Connections & pipeline below.`}
      </p>
      {p?.status && (
        <p className="text-sm">
          {(
            {
              approved: "Prepared — waiting for your publish command",
              scheduled: "Queued for publishing",
              publishing: "Publishing",
              published: "Published",
              failed: "Publishing stopped — please review",
            } as Record<string, string>
          )[p.status] ?? p.status}
        </p>
      )}
      {p?.permalink && (
        <a className="block underline" href={p.permalink} target="_blank" rel="noopener noreferrer">
          View post on Instagram
        </a>
      )}
      {(error || query.error) && <p role="alert">{error || "Publication status unavailable."}</p>}
      {p?.error && <p role="alert">{p.error}</p>}
      {p?.paused && (
        <p className="text-sm">
          Cloud publishing is paused.{" "}
          <a className="underline" href="/publisher#publishing-switch">
            Open publishing settings
          </a>
        </p>
      )}
      {!p?.post_id && (
        <label className="grid gap-2 text-sm">
          Post type
          <select
            aria-label="Post type"
            value={mode}
            disabled={busy}
            onChange={(e) => setMode(e.target.value as "normal" | "trial")}
            className="min-h-12 w-full min-w-0 max-w-full rounded border bg-background p-2"
          >
            <option value="normal">Regular reel</option>
            <option value="trial">Trial reel · manual sharing to feed</option>
          </select>
        </label>
      )}
      {!p?.post_id && (
        <Button
          disabled={busy || dirty || !p?.connected}
          onClick={() => void act({ action: "prepare", publish_mode: mode, ...ref })}
        >
          Prepare post
        </Button>
      )}
      {p?.status === "approved" && (
        <>
          <p className="text-sm">
            The approved video and caption are locked in. Cover: the first video frame.
            {p.publish_mode === "trial"
              ? " This will be a trial reel for non-followers, with no automatic feed sharing or Telegram announcement."
              : " This will be a regular reel, also shown in the feed."}
          </p>
          {confirm ? (
            <div className="rounded border border-primary p-3 space-y-3">
              <p>
                Publish a {p.publish_mode === "trial" ? "trial reel" : "regular reel"} to @
                {p.username} now?
                {p.publish_mode !== "trial" &&
                  " A channel announcement follows a successful post if enabled and still available today."}
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
                Publish {p.publish_mode === "trial" ? "trial reel" : "reel"} to @{p.username} now
              </Button>
              <Button variant="outline" onClick={() => setConfirm(false)}>
                Back
              </Button>
            </div>
          ) : (
            <Button
              disabled={busy || dirty || p.paused || !p.connected}
              onClick={() => setConfirm(true)}
            >
              Publish …
            </Button>
          )}
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void act({ action: "cancel", ...ref })}
          >
            Cancel preparation
          </Button>
        </>
      )}
    </section>
  );
}
