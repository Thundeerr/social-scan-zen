import { describe, expect, it, vi, afterEach } from "vitest";
import { reviewAction, reviewCard, type ReviewItem } from "./content-review";
import { contentReviewTelegramCall } from "./messaging/telegram-transport";
const item = {
  id: "33501d94-c2e4-4037-b73d-294f306f3914",
  model: "tuuva",
  revision: 2,
  title: "Reel",
} as ReviewItem;
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("Content Review boundary", () => {
  it("cannot accept publish actions or arbitrary model identities", () => {
    expect(reviewAction.safeParse({ action: "publish", id: item.id, revision: 2 }).success).toBe(
      false,
    );
    expect(
      reviewAction.safeParse({ action: "create", model: "selma", title: "test", caption: "" })
        .success,
    ).toBe(false);
  });
  it("uses login-gated links, never FanWake callback handlers", () => {
    const card = reviewCard(item, "https://instascanner.app", "8556103033");
    expect(card.caption).toContain("Tuuva");
    expect(card.reply_markup.inline_keyboard[0][0].url).toBe(
      "https://instascanner.app/content-review?item=" + item.id,
    );
    expect(JSON.stringify(card)).not.toContain("callback_data");
    expect(() => reviewCard(item, "http://example.com", "1")).toThrow();
  });
  it("never falls back to another bot's credentials", async () => {
    vi.stubEnv("CONTENT_REVIEW_BOT_TOKEN", "");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "different-bot");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect((await contentReviewTelegramCall({})).ok).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("redacts token-bearing fetch failures and only sends videos", async () => {
    vi.stubEnv("CONTENT_REVIEW_BOT_TOKEN", "secret");
    const fetcher = vi
      .fn()
      .mockRejectedValue(new Error("https://api.telegram.org/botsecret/sendVideo"));
    vi.stubGlobal("fetch", fetcher);
    const response = await contentReviewTelegramCall({ chat_id: "1" });
    expect(response).toEqual({ ok: false, status: 0 });
    expect(fetcher.mock.calls[0][0]).toBe("https://api.telegram.org/botsecret/sendVideo");
    expect(JSON.stringify(response)).not.toContain("secret");
  });
});
