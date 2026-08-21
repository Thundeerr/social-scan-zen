import { describe, expect, it } from "vitest";
import { planContentBatchImport } from "./content-batch-plan";

const packageA = { postKey: "T004", mediaSha256: "media-a", packageSha256: "package-a" };

describe("planContentBatchImport", () => {
  it("keeps new packages pending", () => {
    expect(planContentBatchImport([packageA], []).pendingPostKeys).toEqual(["T004"]);
  });

  it("skips an exact retry and reuses its batch key", () => {
    const result = planContentBatchImport(
      [packageA],
      [
        {
          id: "1",
          postKey: "T004",
          mediaSha256: "media-a",
          packageSha256: "package-a",
          batchKey: "batch-1",
        },
      ],
    );
    expect(result.pendingPostKeys).toEqual([]);
    expect(result.skippedPostKeys).toEqual(["T004"]);
    expect(result.reusableBatchKey).toBe("batch-1");
  });

  it("supports retries of legacy rows that only stored one hash", () => {
    const result = planContentBatchImport(
      [packageA],
      [
        {
          id: "1",
          postKey: "T004",
          mediaSha256: "package-a",
          packageSha256: null,
          batchKey: "batch-1",
        },
      ],
    );
    expect(result.skippedPostKeys).toEqual(["T004"]);
  });

  it("continues the missing remainder of a partially imported batch", () => {
    const packageB = { postKey: "T005", mediaSha256: "media-b", packageSha256: "package-b" };
    const result = planContentBatchImport(
      [packageA, packageB],
      [
        {
          id: "1",
          postKey: "T004",
          mediaSha256: "media-a",
          packageSha256: "package-a",
          batchKey: "batch-1",
        },
      ],
    );
    expect(result.skippedPostKeys).toEqual(["T004"]);
    expect(result.pendingPostKeys).toEqual(["T005"]);
  });

  it("rejects a reused post key with changed content", () => {
    expect(() =>
      planContentBatchImport(
        [packageA],
        [
          {
            id: "1",
            postKey: "T004",
            mediaSha256: "other-media",
            packageSha256: "other-package",
            batchKey: null,
          },
        ],
      ),
    ).toThrow("already exists with different content");
  });

  it("rejects the same media under a different post key", () => {
    expect(() =>
      planContentBatchImport(
        [packageA],
        [
          {
            id: "1",
            postKey: "T003",
            mediaSha256: "media-a",
            packageSha256: "package-old",
            batchKey: null,
          },
        ],
      ),
    ).toThrow("already belongs to T003");
  });

  it("does not merge unrelated historical batch keys", () => {
    const result = planContentBatchImport(
      [],
      [
        { id: "1", postKey: "A", mediaSha256: null, packageSha256: null, batchKey: "one" },
        { id: "2", postKey: "B", mediaSha256: null, packageSha256: null, batchKey: "two" },
      ],
    );
    expect(result.reusableBatchKey).toBeNull();
  });
});
