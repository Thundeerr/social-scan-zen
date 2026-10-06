import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: mock }));
import { workerRequest } from "./reel-inbox.server";
describe("worker endpoint", () => {
  beforeEach(() => mock.rpc.mockReset());
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
});
