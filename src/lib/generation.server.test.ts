import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  download: vi.fn(),
  createSignedUploadUrl: vi.fn(),
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc: mocks.rpc, storage: { from: () => mocks } },
}));
vi.mock("./model-pipeline.server", () => ({ pipelineCommand: vi.fn() }));
import { submitGeneration } from "./generation.server";
import { generationAction } from "./generation";

beforeEach(() => vi.resetAllMocks());
describe("generation safeguards", () => {
  it("passes a validated prompt for the chosen model and rejects client reference overrides", async () => {
    mocks.rpc.mockResolvedValue({ data: { id: "job" } });
    const action = generationAction.parse({
      action: "link",
      model: "kiikii",
      prompt_id: "prompt_1",
      url: "https://instagram.com/reel/Source123/",
    });
    await submitGeneration("owner", action);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "generation_submit",
      expect.objectContaining({
        p_data: expect.objectContaining({ model: "kiikii", prompt_id: "prompt_1" }),
      }),
    );
    expect(() => generationAction.parse({ ...action, reference_profile: "tuuva" })).toThrow();
    expect(() => generationAction.parse({ ...action, prompt_id: "unknown" })).toThrow();
  });
  it("normalizes Instagram links before read-only preflight", async () => {
    mocks.rpc.mockResolvedValue({ data: { id: "", duplicates: [] } });
    await submitGeneration("owner", {
      action: "check_link",
      url: "https://instagram.com/reels/Source123/?utm_source=copy",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("generation_source_check", {
      p_user: "owner",
      p_data: {
        kind: "link",
        shortcode: "Source123",
        url: "https://www.instagram.com/reel/Source123/",
      },
    });
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
  });
  it("rejects non-Instagram previews before a database call", async () => {
    await expect(
      submitGeneration("owner", {
        action: "check_link",
        url: "https://evil.example/reel/Source123/",
      }),
    ).rejects.toThrow();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("uses the stored file hash for the final guard and passes explicit confirmation", async () => {
    const bytes = Buffer.from("0000ftypisom0000");
    mocks.rpc
      .mockResolvedValueOnce({ data: { id: "upload", path: "owner/upload.mp4" } })
      .mockResolvedValueOnce({ data: { id: "", duplicate_warning: true } });
    mocks.download.mockResolvedValue({ data: new Blob([bytes]), error: null });
    const result = await submitGeneration("owner", {
      action: "upload",
      model: "tuuva",
      id: "upload",
      duplicate_confirmed: false,
      prompt_id: "prompt_1",
    });
    expect(result.duplicate_warning).toBe(true);
    expect(mocks.rpc).toHaveBeenLastCalledWith("generation_submit", {
      p_user: "owner",
      p_action: "upload",
      p_data: {
        action: "upload",
        model: "tuuva",
        id: "upload",
        duplicate_confirmed: false,
        prompt_id: "prompt_1",
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
    });
  });
  it("defaults to no confirmation and surfaces a failed preflight", async () => {
    expect(
      generationAction.parse({
        action: "link",
        model: "kiikii",
        prompt_id: "prompt_1",
        url: "https://instagram.com/reel/Source123/",
      }).action,
    ).toBe("link");
    const parsed = generationAction.parse({
      action: "link",
      model: "kiikii",
      prompt_id: "prompt_1",
      url: "https://instagram.com/reel/Source123/",
    });
    if (parsed.action === "link") expect(parsed.duplicate_confirmed).toBe(false);
    mocks.rpc.mockResolvedValue({ error: { message: "private details" } });
    await expect(
      submitGeneration("owner", { action: "check_file", sha256: "a".repeat(64) }),
    ).rejects.toThrow("Duplikatprüfung fehlgeschlagen");
  });
});
