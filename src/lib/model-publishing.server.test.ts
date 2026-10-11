import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
const m = vi.hoisted(() => ({ rpc: vi.fn(), download: vi.fn(), upload: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc: m.rpc, storage: { from: () => m } },
}));
import { modelPublishing } from "./model-publishing.server";
import { modelPublishAction } from "./model-publishing";
const ref = { id: "33501d94-c2e4-4037-b73d-294f306f3914", revision: 1 };
const bytes = Buffer.from("immutable video content"),
  sha256 = createHash("sha256").update(bytes).digest("hex");
beforeEach(() => {
  vi.resetAllMocks();
  m.rpc.mockImplementation(async (_name, p) => ({
    data:
      p.p_action === "get"
        ? { ...ref, status: "approved", sha256, media_path: "source", bytes: bytes.length }
        : { connected: true, post_id: null },
    error: null,
  }));
  m.download.mockResolvedValue({ data: new Blob([bytes]), error: null });
  m.upload.mockResolvedValue({ error: null });
});
it("authorizes before accessing private files", async () => {
  m.rpc.mockResolvedValue({ error: { message: "secret" } });
  await expect(modelPublishing("intruder", { action: "prepare", ...ref })).rejects.toThrow(
    "nicht möglich",
  );
  expect(m.download).not.toHaveBeenCalled();
});
it("copies only verified media insert-only and never publishes on prepare", async () => {
  await modelPublishing("owner", { action: "prepare", ...ref });
  expect(m.upload).toHaveBeenCalledWith(expect.stringContaining(sha256), bytes, {
    contentType: "video/mp4",
    upsert: false,
  });
  expect(m.rpc.mock.calls.some(([, p]) => p.p_action === "publish")).toBe(false);
  expect(m.rpc.mock.calls.some(([, p]) => p.p_action === "prepare")).toBe(true);
});
it("rejects changed media before transfer", async () => {
  m.download.mockResolvedValue({ data: new Blob([Buffer.alloc(bytes.length)]), error: null });
  await expect(modelPublishing("owner", { action: "prepare", ...ref })).rejects.toThrow("geändert");
  expect(m.upload).not.toHaveBeenCalled();
});
it("accepts a lost upload receipt only after verifying the existing copy", async () => {
  m.upload.mockResolvedValue({ error: { message: "conflict" } });
  await modelPublishing("owner", { action: "prepare", ...ref });
  expect(m.download).toHaveBeenCalledTimes(2);
});
it("rejects an unverified conflicting destination", async () => {
  m.upload.mockResolvedValue({ error: {} });
  m.download
    .mockResolvedValueOnce({ data: new Blob([bytes]) })
    .mockResolvedValueOnce({ data: new Blob(["different"]) });
  await expect(modelPublishing("owner", { action: "prepare", ...ref })).rejects.toThrow(
    "nicht bestätigt",
  );
});
it("requires explicit publish confirmation and numeric account identity", () => {
  expect(modelPublishAction.safeParse({ action: "publish", ...ref }).success).toBe(false);
  expect(
    modelPublishAction.safeParse({
      action: "publish",
      ...ref,
      confirmation: "PUBLISH",
      ig_user_id: "123",
    }).success,
  ).toBe(true);
});
