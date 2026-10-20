import { expect, it } from "vitest";
import { applyModelReelMode } from "../../supabase/functions/_shared/instagram-reel";
it("trial uses manual graduation and omits feed sharing", () => {
  const body = applyModelReelMode(
    { media_type: "REELS", share_to_feed: true, caption: "test" },
    "trial",
  );
  expect(JSON.parse(String(body.trial_params))).toEqual({ graduation_strategy: "MANUAL" });
  expect(body).not.toHaveProperty("share_to_feed");
  expect(body.is_ai_generated).toBe(false);
});
it("normal reels keep the explicit feed choice", () => {
  expect(applyModelReelMode({ share_to_feed: true }, "normal")).toEqual({
    share_to_feed: true,
    is_ai_generated: false,
  });
});
it("unknown mode cannot fall back to a normal post", () => {
  expect(() => applyModelReelMode({}, "unknown")).toThrow();
});
