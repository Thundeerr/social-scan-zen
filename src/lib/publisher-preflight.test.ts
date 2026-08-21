import { describe, expect, it, vi } from "vitest";
import { buildPublisherDryRun, type PublisherPreflightPost } from "./publisher-preflight";

const completePost: PublisherPreflightPost = {
  alt_text: "FollowerStar Live Follower Tracker shown on screen.",
  caption: "Track Instagram follower growth live with FollowerStar.",
  cover_storage_path: "user/post/cover.jpg",
  first_comment: "Try the free tracker through the link in our bio.",
  highlight_enabled: true,
  highlight_name: "Free Tools",
  media_manifest: {
    reel: { width: 1080, height: 1920, durationSeconds: 20, bytes: 10_000_000 },
    story: { width: 1080, height: 1920, durationSeconds: 20, bytes: 9_000_000 },
  },
  post_key: "T003-live-001",
  quality_report: [],
  reel_storage_path: "user/post/reel.mp4",
  scheduled_for: null,
  share_to_feed: true,
  status: "review",
  story_link_label: "Try it now",
  story_link_url:
    "https://followerstar.com/tools/live-follower-tracker?utm_source=instagram&utm_medium=story",
  story_publish_mode: "manual_link_sticker",
  story_storage_path: "user/post/story.mp4",
};

describe("buildPublisherDryRun", () => {
  it("builds the dependency-safe Reel, comment and Story plan", () => {
    const result = buildPublisherDryRun(completePost);
    expect(result.ready).toBe(true);
    expect(result.statusLabel).toBe("Ready for review");
    expect(result.steps.map((step) => [step.channel, step.state, step.dependsOn])).toEqual([
      ["reel", "ready", null],
      ["first_comment", "ready", "reel"],
      ["story_handoff", "manual", null],
      ["highlight_handoff", "manual", "story_handoff"],
    ]);
  });

  it("skips an empty first comment without blocking the package", () => {
    const result = buildPublisherDryRun({ ...completePost, first_comment: "" });
    expect(result.ready).toBe(true);
    expect(result.steps[1].state).toBe("skipped");
  });

  it("builds an automatic Story step without requiring a link", () => {
    const result = buildPublisherDryRun({
      ...completePost,
      share_to_feed: false,
      story_link_url: "",
      story_publish_mode: "automatic_no_link",
    });
    expect(result.ready).toBe(true);
    expect(result.steps.map((step) => [step.channel, step.state])).toEqual([
      ["reel", "ready"],
      ["first_comment", "ready"],
      ["story", "ready"],
      ["highlight_handoff", "manual"],
    ]);
  });

  it("blocks missing assets and invalid Story links", () => {
    const result = buildPublisherDryRun({
      ...completePost,
      reel_storage_path: null,
      story_link_url: "https://example.com/not-ours",
    });
    expect(result.ready).toBe(false);
    expect(result.statusLabel).toBe("Action required");
    expect(result.blockers.map((check) => check.code)).toEqual(
      expect.arrayContaining(["reel_asset", "story_link"]),
    );
    expect(result.steps.every((step) => step.state === "blocked")).toBe(true);
  });

  it("blocks wrong dimensions, oversized files and imported quality errors", () => {
    const result = buildPublisherDryRun({
      ...completePost,
      media_manifest: {
        reel: { width: 1920, height: 1080, durationSeconds: 20, bytes: 10_000_000 },
        story: { width: 1080, height: 1920, durationSeconds: 20, bytes: 600 * 1024 * 1024 },
      },
      quality_report: [{ severity: "error", code: "bad", detail: "Broken" }],
    });
    expect(result.ready).toBe(false);
    expect(result.blockers.map((check) => check.code)).toEqual(
      expect.arrayContaining(["reel_metadata", "story_metadata", "quality_report"]),
    );
  });

  it("blocks a past schedule deterministically", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T12:00:00Z"));
    const result = buildPublisherDryRun({
      ...completePost,
      scheduled_for: "2026-08-20T11:59:00Z",
    });
    expect(result.blockers.map((check) => check.code)).toContain("schedule");
    vi.useRealTimers();
  });
});

