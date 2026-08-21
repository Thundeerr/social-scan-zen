import { describe, expect, it } from "vitest";
import { contentManifestSchema } from "./content-package";

const validManifest = {
  version: 1,
  post_key: "T004-tool-001",
  title: "Tool name",
  hook: "A clear hook",
  caption: "A complete caption for the Instagram post.",
  story_link_url: "https://followerstar.com/tools/live-follower-tracker?ref=content",
  files: { cover: "cover.jpg", reel: "reel.mp4", story: "story.mp4" },
};

describe("contentManifestSchema", () => {
  it("accepts a complete package and supplies safe optional defaults", () => {
    const result = contentManifestSchema.parse(validManifest);
    expect(result.first_comment).toBe("");
    expect(result.alt_text).toBe("");
    expect(result.content_pillar).toBe("Product showcase");
    expect(result.share_to_feed).toBe(true);
    expect(result.story_publish_mode).toBe("manual_link_sticker");
    expect(result.highlight_enabled).toBe(true);
    expect(result.story_link_label).toBe("Try it now");
  });

  it("rejects path traversal in post keys", () => {
    expect(() =>
      contentManifestSchema.parse({ ...validManifest, post_key: "../secret" }),
    ).toThrow();
  });

  it("rejects captions above Instagram's limit", () => {
    expect(() =>
      contentManifestSchema.parse({ ...validManifest, caption: "x".repeat(2201) }),
    ).toThrow();
  });

  it("rejects unsupported manifest versions", () => {
    expect(() => contentManifestSchema.parse({ ...validManifest, version: 2 })).toThrow();
  });

  it("rejects insecure Story links", () => {
    expect(() =>
      contentManifestSchema.parse({
        ...validManifest,
        story_link_url: "http://followerstar.com/tools/live-follower-tracker",
      }),
    ).toThrow();
  });

  it("rejects Story links outside FollowerStar", () => {
    expect(() =>
      contentManifestSchema.parse({
        ...validManifest,
        story_link_url: "https://example.com/not-ours",
      }),
    ).toThrow();
  });

  it("accepts automatic Story delivery only without a link sticker", () => {
    const result = contentManifestSchema.parse({
      ...validManifest,
      story_publish_mode: "automatic_no_link",
      story_link_url: "",
    });
    expect(result.story_publish_mode).toBe("automatic_no_link");
    expect(result.story_link_url).toBe("");
    expect(() =>
      contentManifestSchema.parse({
        ...validManifest,
        story_publish_mode: "automatic_no_link",
      }),
    ).toThrow();
  });
});

