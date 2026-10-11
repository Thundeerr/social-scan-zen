import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), send: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { rpc: mocks.rpc } }));
vi.mock("./messaging/telegram-transport", () => ({ channelAlertTelegramCall: mocks.send }));
import { runAlerts, alertTick, operatorAlerts } from "./channel-alerts.server";
const job = {
  id: "job",
  lease: "lease",
  state: "sending",
  model: "kiikii",
  chat_id: "-1003904760564",
  permalink: "https://www.instagram.com/reel/example/",
  message_id: 42,
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("CONTENT_REVIEW_BOT_TOKEN", "8905298936:mock-only");
  mocks.rpc.mockResolvedValue({ data: null, error: null });
});
afterEach(() => vi.unstubAllEnvs());
it("rejects unauthenticated cron without DB or Telegram calls", async () => {
  expect((await alertTick(new Request("https://example.test", { method: "POST" }))).status).toBe(
    401,
  );
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
});
it("rejects invalid cron secret before claiming any work", async () => {
  expect(
    (
      await alertTick(
        new Request("https://example.test", { headers: { "x-cron-secret": "wrong" } }),
      )
    ).status,
  ).toBe(401);
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  expect(mocks.send).not.toHaveBeenCalled();
});
it("authorizes owner before checking bot permissions", async () => {
  mocks.rpc.mockResolvedValue({ error: { message: "private" } });
  await expect(operatorAlerts("intruder", { action: "check", model: "kiikii" })).rejects.toThrow();
  expect(mocks.send).not.toHaveBeenCalled();
});
it("never repeats an ambiguous Telegram send", async () => {
  mocks.rpc.mockResolvedValueOnce({ data: job });
  mocks.send.mockResolvedValue({ ok: false });
  await runAlerts();
  expect(mocks.send).toHaveBeenCalledTimes(1);
  expect(mocks.rpc.mock.calls[1][1].p_action).toBe("uncertain");
});
it("retries only database acknowledgement after confirmed send", async () => {
  mocks.rpc
    .mockResolvedValueOnce({ data: job })
    .mockResolvedValueOnce({ error: {} })
    .mockResolvedValueOnce({ data: { ok: true } });
  mocks.send.mockResolvedValue({
    ok: true,
    result: {
      message_id: 42,
      date: Math.floor(Date.now() / 1000),
      chat: { id: Number(job.chat_id) },
    },
  });
  await runAlerts();
  expect(mocks.send).toHaveBeenCalledTimes(1);
  expect(mocks.rpc.mock.calls.slice(1, 3).map((c) => c[1].p_action)).toEqual(["sent", "sent"]);
});
it("does not accept a receipt from a different channel", async () => {
  mocks.rpc.mockResolvedValueOnce({ data: job });
  mocks.send.mockResolvedValue({
    ok: true,
    result: { message_id: 42, date: Math.floor(Date.now() / 1000), chat: { id: 123 } },
  });
  await runAlerts();
  expect(mocks.rpc.mock.calls[1][1].p_action).toBe("uncertain");
});
it("deletes only the recorded message in the recorded channel", async () => {
  mocks.rpc.mockResolvedValueOnce({ data: { ...job, state: "deleting" } });
  mocks.send.mockResolvedValue({ ok: true, result: true });
  await runAlerts();
  expect(mocks.send).toHaveBeenCalledWith("deleteMessages", {
    chat_id: job.chat_id,
    message_ids: [42],
  });
  expect(mocks.rpc.mock.calls[1][1].p_action).toBe("deleted");
});
it("preserves failed deletions for a later retry", async () => {
  mocks.rpc.mockResolvedValueOnce({ data: { ...job, state: "deleting" } });
  mocks.send.mockResolvedValue({ ok: false });
  await runAlerts();
  expect(mocks.rpc.mock.calls[1][1].p_action).toBe("delete_retry");
});
