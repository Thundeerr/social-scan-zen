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
