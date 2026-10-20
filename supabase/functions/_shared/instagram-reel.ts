export function buildReelContainerFields(input: {
  caption: string;
  shareToFeed: boolean;
  coverUrl: string;
}) {
  const coverUrl = input.coverUrl.trim();
  if (!coverUrl) throw new Error("Reel cover URL is missing");
  return {
    caption: input.caption,
    share_to_feed: input.shareToFeed,
    cover_url: coverUrl,
  };
}

export function applyModelReelMode(body: Record<string, string | boolean | number>, mode: string) {
  if (mode !== "normal" && mode !== "trial") throw new Error("Invalid model publishing mode");
  body.is_ai_generated = false;
  if (mode === "trial") {
    delete body.share_to_feed;
    body.trial_params = JSON.stringify({ graduation_strategy: "MANUAL" });
  }
  return body;
}
