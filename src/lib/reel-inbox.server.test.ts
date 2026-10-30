import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  configured: vi.fn(),
  resolve: vi.fn(),
}));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: mock }));
vi.mock("./reel-source.server", async (original) => ({
  ...(await original<typeof import("./reel-source.server")>()),
  reelProviderConfigured: mock.configured,
  resolveReelSource: mock.resolve,
}));
import { workerRequest } from "./reel-inbox.server";
import { ReelSourceError } from "./reel-source.server";
describe("worker endpoint", () => {
  beforeEach(() => {
    mock.rpc.mockReset();
    mock.resolve.mockReset();
    mock.from.mockReset();
    mock.configured.mockReturnValue(true);
  });
  const request = (body: unknown, token = "a".repeat(64)) =>
    new Request("https://instascanner.app/api/reel-inbox/worker", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  it("denies missing and malformed tokens without database access", async () => {
    expect((await workerRequest(request({ action: "claim" }, "bad"))).status).toBe(401);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("denies malformed payloads and oversized streaming bodies", async () => {
    expect((await workerRequest(request({ action: "delete" }))).status).toBe(400);
    expect((await workerRequest(request("x".repeat(200001)))).status).toBe(413);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("passes only a SHA256 digest and no operator identity", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: null });
    const response = await workerRequest(
      request({ action: "claim", instance: crypto.randomUUID() }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const args = mock.rpc.mock.calls[0][1];
    expect(args.p_user).toBeNull();
    expect(args.p_device_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(args.p_device_hash).not.toBe("a".repeat(64));
  });
  it("does not disclose database or token errors", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { message: "secret-database-internals" } });
    const response = await workerRequest(
      request({ action: "claim", instance: crypto.randomUUID() }),
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret-database-internals");
  });
  it("rejects caller-supplied source URLs", async () => {
    const response = await workerRequest(
      request({
        action: "resolve",
        id: crypto.randomUUID(),
        lease: crypto.randomUUID(),
        url: "https://evil.test",
      }),
    );
    expect(response.status).toBe(400);
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(mock.resolve).not.toHaveBeenCalled();
  });
  it("requires the owned active lease before invoking the provider", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { message: "stale lease" } });
    expect(
      (
        await workerRequest(
          request({ action: "resolve", id: crypto.randomUUID(), lease: crypto.randomUUID() }),
        )
      ).status,
    ).toBe(503);
    expect(mock.resolve).not.toHaveBeenCalled();
  });
  it("uses only the database source and accounts for the reserved request", async () => {
    const source = {
      canonical_url: "https://www.instagram.com/reel/ABCDE/",
      shortcode: "ABCDE",
      run_id: crypto.randomUUID(),
    };
    mock.rpc
      .mockResolvedValueOnce({ data: { ok: true }, error: null })
      .mockResolvedValueOnce({ data: source, error: null });
    const result = {
      url: "https://video.fbcdn.net/test.mp4",
      metadata: { title: "Test", creator: "test" },
    };
    mock.resolve.mockResolvedValue(result);
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq });
    mock.from.mockReturnValue({ update });
    const response = await workerRequest(
      request({ action: "resolve", id: crypto.randomUUID(), lease: crypto.randomUUID() }),
    );
    expect(await response.json()).toEqual(result);
    expect(mock.rpc.mock.calls[0][1].p_action).toBe("renew");
    expect(mock.rpc.mock.calls[1][0]).toBe("reel_inbox_resolve_source");
    expect(mock.resolve).toHaveBeenCalledExactlyOnceWith(source.canonical_url, source.shortcode);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed", error: null }),
    );
    expect(eq).toHaveBeenCalledWith("id", source.run_id);
  });
  it.each([null, { error: "setup" }])(
    "does not spend on a repeated lease or exhausted budget",
    async (data) => {
      mock.rpc
        .mockResolvedValueOnce({ data: { ok: true }, error: null })
        .mockResolvedValueOnce({ data, error: null });
      const response = await workerRequest(
        request({ action: "resolve", id: crypto.randomUUID(), lease: crypto.randomUUID() }),
      );
      expect((await response.json()).error).toBe(data ? "setup" : "unavailable");
      expect(mock.resolve).not.toHaveBeenCalled();
    },
  );
  it.each([
    ["provider_http_429", " (provider_http_429)"],
    ["provider_http_503", " (provider_http_503)"],
    ["provider_timeout", " (provider_timeout)"],
    ["provider_aborted", " (provider_aborted)"],
    ["provider_type_error", " (provider_type_error)"],
    ["provider_network", " (provider_network)"],
    ["https://private.invalid/?key=secret", ""],
    ["provider_http_429\nsecret", ""],
    ["provider_timeout\n", ""],
    [undefined, ""],
  ])(
    "records only allowlisted diagnostic %s and keeps the helper response unchanged",
    async (reason, suffix) => {
      const source = {
        canonical_url: "https://www.instagram.com/reel/ABCDE/",
        shortcode: "ABCDE",
        run_id: crypto.randomUUID(),
      };
      mock.rpc
        .mockResolvedValueOnce({ data: { ok: true }, error: null })
        .mockResolvedValueOnce({ data: source, error: null });
      mock.resolve.mockRejectedValue(Object.assign(new ReelSourceError("interrupted"), { reason }));
      const eq = vi.fn().mockResolvedValue({ error: null });
      const update = vi.fn().mockReturnValue({ eq });
      mock.from.mockReturnValue({ update });
      const response = await workerRequest(
        request({ action: "resolve", id: crypto.randomUUID(), lease: crypto.randomUUID() }),
      );
      expect(await response.json()).toEqual({ error: "interrupted" });
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "failed",
          error: "interrupted",
          phase_detail: `Reel download fallback: interrupted${suffix}`,
        }),
      );
      expect(eq).toHaveBeenCalledWith("id", source.run_id);
    },
  );
});
