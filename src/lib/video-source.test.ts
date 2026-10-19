import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadSourceVideo, parseVideoSource, reviewVideoReference } from "./video-source";
import { MAX_SOURCE_BYTES } from "./generation";

afterEach(() => vi.unstubAllGlobals());
describe("copied video sources", () => {
  it("round-trips a stable review identity without a signed URL", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(parseVideoSource(reviewVideoReference(id, 3))).toEqual({
      kind: "review",
      id,
      revision: 3,
    });
  });
  it("keeps Instagram intake and supports direct HTTPS URLs", () => {
    expect(parseVideoSource("https://www.instagram.com/reel/Source123/?igsh=abc").kind).toBe(
      "instagram",
    );
    expect(parseVideoSource("https://cdn.example.com/video.mp4")).toEqual({
      kind: "video",
      url: "https://cdn.example.com/video.mp4",
    });
  });
  it.each([
    "http://cdn.example.com/video.mp4",
    "https://127.0.0.1/x",
    "https://[::1]/x",
    "https://server.local/x",
    "https://user:pass@example.com/x",
    "instascanner:review:not-a-uuid:2",
    "instascanner:review:11111111-1111-4111-8111-111111111111:0",
  ])("rejects invalid or local source %s", (url) => {
    expect(() => parseVideoSource(url)).toThrow();
  });
  it("loads an MP4 without credentials or redirects", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(new Uint8Array([0, 0, 0, 12, 102, 116, 121, 112, 105, 115, 111, 109])),
      );
    vi.stubGlobal("fetch", fetcher);
    const signal = new AbortController().signal;
    const file = await downloadSourceVideo("https://cdn.example.com/video", signal);
    expect(file.size).toBe(12);
    expect(file.name).toMatch(/\.mp4$/);
    expect(fetcher).toHaveBeenCalledWith("https://cdn.example.com/video", {
      signal,
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
  });
  it("rejects HTML and oversized responses before submission", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>not video</html>")));
    await expect(
      downloadSourceVideo("https://example.com", new AbortController().signal),
    ).rejects.toThrow("MP4");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("x", { headers: { "content-length": String(MAX_SOURCE_BYTES + 1) } }),
        ),
    );
    await expect(
      downloadSourceVideo("https://example.com", new AbortController().signal),
    ).rejects.toThrow("40 MB");
  });
});
