import { createHmac } from "node:crypto";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { verifyReviewLaunch } from "./telegram-review-auth.server";
const mocks = vi.hoisted(() => ({ review: vi.fn(), publish: vi.fn() }));
vi.mock("./content-review.server", () => ({ reviewCommand: mocks.review }));
vi.mock("./model-publishing.server", () => ({ modelPublishing: mocks.publish }));
import { telegramReviewRequest } from "./telegram-review.server";
const token = "8905298936:test-only",
  owner = "8556103033";
function sign(
  id = Number(owner),
  date = Math.floor(Date.now() / 1000),
  extra: Record<string, string> = {},
) {
  const p = new URLSearchParams({
    auth_date: String(date),
    user: JSON.stringify({ id, first_name: "Owner" }),
    ...extra,
  });
  const data = [...p.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  p.set(
    "hash",
    createHmac("sha256", createHmac("sha256", "WebAppData").update(token).digest())
      .update(data)
      .digest("hex"),
  );
  return p.toString();
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CONTENT_REVIEW_BOT_TOKEN", token);
  vi.stubEnv("CONTENT_REVIEW_TELEGRAM_CHAT_ID", owner);
  vi.stubEnv("CONTENT_REVIEW_ORIGIN", "https://instascanner.app");
  mocks.review.mockResolvedValue({ items: [] });
});
describe("Telegram owner authentication", () => {
  it("validates signatures, including Telegram's optional signature field", () => {
    expect(verifyReviewLaunch(sign(), token, owner)).toBe(true);
    expect(
      verifyReviewLaunch(
        sign(Number(owner), Math.floor(Date.now() / 1000), { signature: "signed-by-telegram" }),
        token,
        owner,
      ),
    ).toBe(true);
  });
  it("rejects another user, expired/future data, wrong bot, tampering and duplicate keys", () => {
    for (const raw of [
      sign(123),
      sign(Number(owner), Math.floor(Date.now() / 1000) - 901),
      sign(Number(owner), Math.floor(Date.now() / 1000) + 60),
      sign().replace("Owner", "Attacker"),
      sign() + "&user=%7B%7D",
    ])
      expect(verifyReviewLaunch(raw, token, owner)).toBe(false);
    expect(verifyReviewLaunch(sign(), "other:bot", owner)).toBe(false);
  });
  const req = (body: unknown, origin = "https://instascanner.app") =>
    new Request("https://instascanner.app/api/public/telegram/review", {
      method: "POST",
      headers: { origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  it("does not trust a Telegram id or database owner in client parameters", async () => {
    expect(
      (
        await telegramReviewRequest(
          req({ initData: "user=" + owner, area: "review", action: { action: "list" } }),
        )
      ).status,
    ).toBe(401);
    expect(mocks.review).not.toHaveBeenCalled();
    expect(
      (
        await telegramReviewRequest(
          req({ initData: sign(), area: "review", action: { action: "list" }, owner: "attacker" }),
        )
      ).status,
    ).toBe(200);
    expect(mocks.review).toHaveBeenCalledWith("e4ee414f-fbb6-4f82-b5fc-22d74ed6b3cc", {
      action: "list",
    });
  });
  it("rejects cross-origin requests, creation, notification and incomplete publish confirmations", async () => {
    expect(
      (
        await telegramReviewRequest(
          req(
            { initData: sign(), area: "review", action: { action: "list" } },
            "https://evil.invalid",
          ),
        )
      ).status,
    ).toBe(403);
    for (const area of ["review", "publish"])
      expect(
        (
          await telegramReviewRequest(
            req({ initData: sign(), area, action: { action: "publish" } }),
          )
        ).status,
      ).toBe(400);
    expect(mocks.publish).not.toHaveBeenCalled();
  });
});
