import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  command: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  in: vi.fn(),
}));
vi.mock("./model-pipeline.server", () => ({ pipelineCommand: mocks.command }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: mocks.from } }));
import { generationHistory } from "./generation-history.server";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.from.mockReturnValue(mocks);
  mocks.select.mockReturnValue(mocks);
  mocks.eq.mockReturnValue(mocks);
});
it("joins only the authenticated owner's linked reviews and omits internal job fields", async () => {
  mocks.command.mockResolvedValue({
    enabled: false,
    jobs: [
      {
        id: "job",
        model: "kiikii",
        state: "review",
        review_id: "review",
        created_at: "2026-10-19",
        issue: null,
        provider_id: "private",
        lease: "private",
      },
      { id: "other", model: "tuuva", state: "queued", review_id: null },
    ],
  });
  mocks.in.mockResolvedValue({
    data: [{ id: "review", title: "Video", revision: 2, status: "approved" }],
  });
  const result = await generationHistory("owner");
  expect(mocks.command).toHaveBeenCalledWith("status", "owner");
  expect(mocks.eq).toHaveBeenCalledWith("user_id", "owner");
  expect(mocks.in).toHaveBeenCalledWith("id", ["review"]);
  expect(result.jobs[0].review?.revision).toBe(2);
  expect(result.jobs[0]).not.toHaveProperty("provider_id");
  expect(result.jobs[0]).not.toHaveProperty("lease");
  expect(result.jobs[1].review).toBeNull();
});
it("does not query reviews when authorization fails", async () => {
  mocks.command.mockRejectedValue(Error("owner required"));
  await expect(generationHistory("other-user")).rejects.toThrow();
  expect(mocks.from).not.toHaveBeenCalled();
});
it("returns an empty list without querying media", async () => {
  mocks.command.mockResolvedValue({ enabled: false, jobs: [] });
  expect(await generationHistory("owner")).toEqual({ enabled: false, jobs: [] });
  expect(mocks.from).not.toHaveBeenCalled();
});
it("reports a review lookup failure instead of presenting it as a missing output", async () => {
  mocks.command.mockResolvedValue({ jobs: [{ id: "job", review_id: "review" }] });
  mocks.in.mockResolvedValue({ error: { message: "database failure" } });
  await expect(generationHistory("owner")).rejects.toThrow(
    "Ergebnisse konnten nicht geladen werden.",
  );
});
