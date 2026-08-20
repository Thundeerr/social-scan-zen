import { describe, expect, it } from "vitest";
import { contentManifestSchema } from "./content-package";

const validManifest = {
  version: 1,
  post_key: "T004-tool-001",
  title: "Tool name",
  hook: "A clear hook",
  caption: "A complete caption for the Instagram post.",
  files: { cover: "cover.jpg", reel: "reel.mp4", story: "story.mp4" },
};

describe("contentManifestSchema", () => {
  it("accepts a complete package and supplies safe optional defaults", () => {
    const result = contentManifestSchema.parse(validManifest);
    expect(result.first_comment).toBe("");
    expect(result.alt_text).toBe("");
    expect(result.content_pillar).toBe("Product showcase");
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
});
