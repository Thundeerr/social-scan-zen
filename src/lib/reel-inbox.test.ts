import { describe, it, expect } from "vitest";
import { canonicalReel, parseReelLinks, workerAction } from "./reel-inbox";
describe("Reel Inbox links", () => {
  it("strips tracking including the supplied test post", () => {
    expect(
      canonicalReel("https://www.instagram.com/p/DdQN9krAjJn/?stkn=tracking#fragment"),
    ).toEqual({ shortcode: "DdQN9krAjJn", url: "https://www.instagram.com/p/DdQN9krAjJn/" });
  });
  it("preserves shortcode case and accepts a mixed batch without losing invalid input", () => {
    const result = parseReelLinks(
      "https://instagram.com/reel/ABC_def/?igsh=x\ninvalid\nhttps://m.instagram.com/reels/ABC_def/",
    );
    expect(result.map((x) => x.shortcode)).toEqual(["ABC_def", null, "ABC_def"]);
  });
  it.each([
    "http://instagram.com/reel/ABCDE/",
    "https://instagram.com.evil.test/reel/ABCDE/",
    "https://user:pw@instagram.com/reel/ABCDE/",
    "https://instagram.com:444/reel/ABCDE/",
    "https://instagram.com/stories/ABCDE/",
    "https://instagram.com/reel/../../x",
    "https://127.0.0.1/reel/ABCDE/",
  ])("rejects %s", (url) => expect(() => canonicalReel(url)).toThrow());
  it("bounds batches and rejects arbitrary receipts", () => {
    expect(() => parseReelLinks(Array(51).fill("bad").join("\n"))).toThrow();
    expect(
      workerAction.safeParse({
        action: "ack",
        id: crypto.randomUUID(),
        lease: crypto.randomUUID(),
        receipt: { folder: "../../outside" },
      }).success,
    ).toBe(false);
  });
});
