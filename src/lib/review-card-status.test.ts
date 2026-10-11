import { expect, it, vi, beforeEach, afterEach } from "vitest";
import { reviewStatusCard } from "./review-card-status";
import type { ReviewItem } from "./content-review";
const item = {
  id: "33501d94-c2e4-4037-b73d-294f306f3914",
  model: "kiikii",
  title: "Cat reel",
  revision: 2,
  status: "approved",
} as ReviewItem;
it("shows the exact Berlin date, mode and unchanged mini-app buttons", () => {
  const card = reviewStatusCard(
    item,
    { status: "scheduled", scheduled_for: "2026-10-11T17:00:00Z", publish_mode: "trial" },
    "https://instascanner.app",
    "8556103033",
  );
  expect(card.caption).toContain("19:00");
  expect(card.caption).toContain("11. Oktober 2026");
  expect(card.caption).toContain("Trial Reel");
  expect(card.caption).toContain("Geplant");
  expect(card.reply_markup.inline_keyboard[0][0]).toHaveProperty("web_app");
  expect(card.caption.length).toBeLessThan(1024);
  expect(
    reviewStatusCard(
      item,
      { status: "scheduled", scheduled_for: "2026-11-01T18:00:00Z", publish_mode: "normal" },
      "https://instascanner.app",
      "8556103033",
    ).caption,
  ).toContain("19:00");
});
it("does not describe cancellation, publishing or failure as a future scheduled post", () => {
  for (const [status, label] of [
    ["approved", "noch kein Posting-Termin"],
    ["publishing", "Wird gerade"],
    ["published", "Veröffentlicht"],
    ["failed", "gestoppt"],
  ]) {
    const text = reviewStatusCard(
      item,
      { status, scheduled_for: null, publish_mode: "normal" },
      "https://instascanner.app",
      "8556103033",
    ).caption;
    expect(text).toContain(label);
    expect(text).not.toContain("Geplant für");
  }
});
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), telegram: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { rpc: mocks.rpc } }));
vi.mock("./messaging/telegram-transport", () => ({ channelAlertTelegramCall: mocks.telegram }));
import { syncReviewCards } from "./review-card-sync.server";
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("CONTENT_REVIEW_BOT_TOKEN", "8905298936:test-only");
});
afterEach(() => vi.unstubAllEnvs());
it("edits the existing video card and records retry on an uncertain result, never sends another card", async () => {
  mocks.rpc
    .mockResolvedValueOnce({
      data: {
        id: item.id,
        lease: "lease",
        item: { ...item, telegram_message_id: 10 },
        post: { status: "scheduled", scheduled_for: "2026-10-11T17:00:00Z", publish_mode: "trial" },
      },
    })
    .mockResolvedValue({ data: { ok: true } });
  mocks.telegram.mockResolvedValue({ ok: false });
  await syncReviewCards("e4ee414f-fbb6-4f82-b5fc-22d74ed6b3cc", item.id);
  expect(mocks.telegram).toHaveBeenCalledWith(
    "editMessageCaption",
    expect.objectContaining({ message_id: 10, chat_id: "8556103033" }),
  );
  expect(mocks.rpc.mock.calls[1][1].p_action).toBe("retry");
});
it("rejects another owner before touching Telegram or the queue", async () => {
  await syncReviewCards("other-owner", item.id);
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.telegram).not.toHaveBeenCalled();
});
