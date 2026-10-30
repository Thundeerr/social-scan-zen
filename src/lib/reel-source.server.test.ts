import { afterEach, describe, expect, it, vi } from "vitest";
import { parseReelSource, resolveReelSource } from "./reel-source.server";

const code = "DfF6gi4RyQu";
const url = `https://www.instagram.com/reel/${code}/`;
const video = {
  code,
  media_type: 2,
  caption: { text: "Original caption" },
  user: { username: "creator" },
  video_versions: [
    { url: "https://video.cdninstagram.com/low.mp4", width: 480, height: 854 },
    { url: "https://video.fbcdn.net/high.mp4", width: 1080, height: 1920 },
  ],
};
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("exact Reel source", () => {
  it("selects the best video rendition and bounded caption metadata", () => {
    expect(parseReelSource({ data: { items: [video] } }, code)).toEqual({
      url: "https://video.fbcdn.net/high.mp4",
      metadata: { title: "Original caption", creator: "creator" },
    });
  });
  it("supports the GraphQL single-video response", () => {
    expect(
      parseReelSource(
        {
          data: {
            xdt_shortcode_media: {
              shortcode: code,
              __typename: "GraphVideo",
              is_video: true,
              video_url: "https://video.cdninstagram.com/a.mp4",
              edge_media_to_caption: { edges: [{ node: { text: "Caption" } }] },
              owner: { username: "test" },
            },
          },
        },
        code,
      ).metadata.title,
    ).toBe("Caption");
  });
  it.each([
    { ...video, code: "DifferentCode" },
    { ...video, user: { is_private: true } },
    { ...video, video_versions: [{ url: "https://cdninstagram.com.evil.test/video.mp4" }] },
    { ...video, video_versions: [{ url: "http://video.fbcdn.net/a.mp4" }] },
    { ...video, video_versions: [{ url: "https://user:pass@video.fbcdn.net/a.mp4" }] },
    { ...video, video_versions: [{ url: "https://127.0.0.1/a.mp4" }] },
    { ...video, video_versions: [{ url: "https://video.fbcdn.net:8443/a.mp4" }] },
  ])("rejects mismatched, private or unsafe results", (value) => {
    expect(() => parseReelSource(value, code)).toThrow("unavailable");
  });
  it.each([
    { ...video, media_type: 1 },
    { ...video, media_type: 8, carousel_media: [video] },
    { ...video, __typename: "GraphSidecar" },
  ])("rejects images and carousel children", (value) => {
    expect(() => parseReelSource(value, code)).toThrow("unsupported");
  });
  it("does not use an unrelated recommendation or thumbnail", () => {
    expect(() => parseReelSource({ recommendations: [video] }, code)).toThrow("unavailable");
    expect(() =>
      parseReelSource(
        { ...video, video_versions: [], thumbnail_url: "https://video.fbcdn.net/photo.jpg" },
        code,
      ),
    ).toThrow("unavailable");
  });
});

describe("provider request", () => {
  function configure() {
    vi.stubEnv("RAPIDAPI_KEY", "test-key-never-returned");
    vi.stubEnv("RAPIDAPI_HOST", "instagram-looter2.p.rapidapi.com");
  }
  it("uses one exact-media request and never follows redirects", async () => {
    configure();
    const fetcher = vi.fn().mockResolvedValue(Response.json(video));
    vi.stubGlobal("fetch", fetcher);
    expect((await resolveReelSource(url, code)).metadata.creator).toBe("creator");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [target, init] = fetcher.mock.calls[0];
    expect(target.origin).toBe("https://instagram-looter2.p.rapidapi.com");
    expect(target.pathname).toBe("/post");
    expect(target.searchParams.get("url")).toBe(url);
    expect(init.redirect).toBe("manual");
  });
  it("does not send a key to an unconfigured host or caller URL", async () => {
    configure();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    vi.stubEnv("RAPIDAPI_HOST", "evil.test");
    await expect(resolveReelSource(url, code)).rejects.toThrow("setup");
    await expect(resolveReelSource("https://evil.test/reel/ABCDE/", code)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    [429, "interrupted"],
    [503, "interrupted"],
    [401, "setup"],
    [403, "setup"],
    [404, "unavailable"],
  ])("maps HTTP %s without disclosing the provider body", async (status, message) => {
    configure();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("secret body", { status: Number(status) })),
    );
    await expect(resolveReelSource(url, code)).rejects.toMatchObject({
      code: message,
      message,
      reason: `provider_http_${status}`,
    });
  });
  it.each([
    ["TimeoutError", "provider_timeout"],
    ["AbortError", "provider_aborted"],
    ["TypeError", "provider_type_error"],
    ["Error", "provider_network"],
  ])("records a safe %s diagnostic without the network message", async (name, reason) => {
    configure();
    const failure = new Error("https://private.invalid/video?key=secret-network-data");
    failure.name = name;
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(failure));
    await expect(resolveReelSource(url, code)).rejects.toMatchObject({
      code: "interrupted",
      message: "interrupted",
      reason,
    });
  });
  it("rejects a provider redirect without issuing a second fetch or forwarding credentials", async () => {
    configure();
    const fetcher = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: "https://untrusted.invalid/collect" },
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(resolveReelSource(url, code)).rejects.toMatchObject({
      code: "unavailable",
      reason: "provider_http_302",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1].redirect).toBe("manual");
    expect(fetcher.mock.calls[0][0].origin).toBe("https://instagram-looter2.p.rapidapi.com");
  });
  it("preserves the HTTP diagnostic if response-body cleanup fails", async () => {
    configure();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        body: { cancel: vi.fn().mockRejectedValue(new Error("private cleanup detail")) },
      }),
    );
    await expect(resolveReelSource(url, code)).rejects.toMatchObject({
      code: "interrupted",
      reason: "provider_http_429",
    });
  });
  it("bounds response size and rejects HTML", async () => {
    configure();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("x".repeat(2 * 1024 * 1024 + 1)))
      .mockResolvedValueOnce(new Response("<html>not media</html>"));
    vi.stubGlobal("fetch", fetcher);
    await expect(resolveReelSource(url, code)).rejects.toThrow("unavailable");
    await expect(resolveReelSource(url, code)).rejects.toThrow("unavailable");
  });
});
