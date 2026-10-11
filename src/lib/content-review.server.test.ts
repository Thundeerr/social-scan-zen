import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  storage: { createSignedUploadUrl: vi.fn(), download: vi.fn(), createSignedUrl: vi.fn() },
  send: vi.fn(),
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc: mocks.rpc, storage: { from: () => mocks.storage } },
}));
vi.mock("./messaging/telegram-transport", () => ({ contentReviewTelegramCall: mocks.send }));
import { reviewCommand } from "./content-review.server";
const id = "33501d94-c2e4-4037-b73d-294f306f3914";
const owner = "e4ee414f-fbb6-4f82-b5fc-22d74ed6b3cc";
const ref = { id, revision: 1 };
const item = {
  ...ref,
  status: "pending",
  model: "tuuva",
  title: "Draft",
  media_path: owner + "/" + id + "/video.mp4",
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("CONTENT_REVIEW_BOT_TOKEN", "");
  mocks.rpc.mockResolvedValue({ data: item, error: null });
});
afterEach(() => vi.unstubAllEnvs());
describe("Content Review server", () => {
  it("authorizes before touching private media", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "private DB details" } });
    await expect(reviewCommand("intruder", { action: "preview", ...ref })).rejects.toThrow(
      "Aktion nicht möglich",
    );
    expect(mocks.storage.createSignedUrl).not.toHaveBeenCalled();
  });
  it("rejects stale requests before generating media URLs", async () => {
    await expect(reviewCommand(owner, { action: "preview", ...ref, revision: 2 })).rejects.toThrow(
      "Neuere Version",
    );
    expect(mocks.storage.createSignedUrl).not.toHaveBeenCalled();
  });
  it("cannot notify without dedicated server credentials", async () => {
    await expect(reviewCommand(owner, { action: "notify", ...ref })).rejects.toThrow("noch nicht");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("uses insert-only upload tokens and never permits an approved media overwrite", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...item, status: "uploading" }, error: null });
    mocks.storage.createSignedUploadUrl.mockResolvedValue({
      data: { token: "signed", path: item.media_path },
      error: null,
    });
    await reviewCommand(owner, { action: "upload", ...ref });
    expect(mocks.storage.createSignedUploadUrl).toHaveBeenCalledWith(item.media_path, {
      upsert: false,
    });
    mocks.rpc.mockResolvedValue({ data: { ...item, status: "approved" }, error: null });
    await expect(reviewCommand(owner, { action: "upload", ...ref })).rejects.toThrow(
      "bereits gespeichert",
    );
  });
  it("does not finalize missing or non-MP4 media", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...item, status: "uploading" }, error: null });
    mocks.storage.download.mockResolvedValue({ data: new Blob(["not an mp4 file"]), error: null });
    await expect(reviewCommand(owner, { action: "finalize", ...ref })).rejects.toThrow("MP4");
    expect(mocks.rpc.mock.calls.map((c) => c[1].p_action)).toEqual(["get"]);
  });
  it("records uncertain send results and never publishes", async () => {
    vi.stubEnv("CONTENT_REVIEW_BOT_TOKEN", "mock-only");
    mocks.storage.createSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://storage.example/signed" },
      error: null,
    });
    mocks.send.mockResolvedValue({ ok: false, status: 0 });
    await expect(reviewCommand(owner, { action: "notify", ...ref })).rejects.toThrow(
      "nicht bestätigt",
    );
    expect(mocks.rpc.mock.calls.map((c) => c[1].p_action)).toEqual([
      "get",
      "reserve_notification",
      "finish_notification",
    ]);
    expect(mocks.rpc.mock.calls[2][1].p_payload.message_id).toBeNull();
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
});
