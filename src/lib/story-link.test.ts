import { describe, expect, it } from "vitest";
import { isAllowedFollowerStarStoryUrl, withInstagramStoryTracking } from "./story-link";

describe("Story link helpers", () => {
  it("allows FollowerStar and its subdomains only over HTTPS", () => {
    expect(isAllowedFollowerStarStoryUrl("https://followerstar.com/tools/example")).toBe(true);
    expect(isAllowedFollowerStarStoryUrl("https://go.followerstar.com/example")).toBe(true);
    expect(isAllowedFollowerStarStoryUrl("http://followerstar.com/tools/example")).toBe(false);
    expect(isAllowedFollowerStarStoryUrl("https://user@followerstar.com/tools/example")).toBe(
      false,
    );
    expect(isAllowedFollowerStarStoryUrl("https://followerstar.com:444/tools/example")).toBe(false);
    expect(isAllowedFollowerStarStoryUrl("https://followerstar.com.evil.test/example")).toBe(false);
  });

  it("adds deterministic Instagram Story tracking without losing existing parameters", () => {
    const tracked = new URL(
      withInstagramStoryTracking(
        "https://followerstar.com/tools/example?plan=free&utm_source=old",
        "T004-tool-001",
      ),
    );
    expect(tracked.searchParams.get("plan")).toBe("free");
    expect(tracked.searchParams.get("utm_source")).toBe("instagram");
    expect(tracked.searchParams.get("utm_medium")).toBe("story");
    expect(tracked.searchParams.get("utm_campaign")).toBe("T004-tool-001");
    expect(tracked.searchParams.get("utm_content")).toBe("link_sticker");
  });
});
