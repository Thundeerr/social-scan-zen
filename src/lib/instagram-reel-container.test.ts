import { describe, expect, it } from "vitest";
import { buildReelContainerFields } from "../../supabase/functions/_shared/instagram-reel";

describe("buildReelContainerFields", () => {
  it("uses the autonomous cover and shares the same Reel to Feed", () => {
    expect(
      buildReelContainerFields({
        caption: "FollowerStar caption",
        shareToFeed: true,
        coverUrl: "https://storage.example/cover.jpg?token=secret",
      }),
    ).toEqual({
      caption: "FollowerStar caption",
      share_to_feed: true,
      cover_url: "https://storage.example/cover.jpg?token=secret",
    });
  });

  it("never silently falls back to the first video frame", () => {
    expect(() =>
      buildReelContainerFields({ caption: "Caption", shareToFeed: true, coverUrl: "  " }),
    ).toThrow("Reel cover URL is missing");
  });
});
