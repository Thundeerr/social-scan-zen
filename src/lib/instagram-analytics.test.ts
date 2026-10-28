import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: mocks.from } }));
import { metricValues, safeInstagramLink } from "./instagram-analytics";
import { instagramAnalyticsGet, syncInstagramAnalytics } from "./instagram-analytics.server";
const owner = "e4ee414f-fbb6-4f82-b5fc-22d74ed6b3cc";
const now = new Date("2026-10-28T18:55:00Z");
function database(rows: unknown[]) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  mocks.from.mockImplementation((table: string) => {
    const result = { data: rows.shift(), error: null };
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "lt", "upsert", "update", "single", "maybeSingle"])
      chain[method] = (...args: unknown[]) => {
        calls.push({ table, method, args });
        return chain;
      };
    chain.then = (resolve: (value: unknown) => void) => Promise.resolve(result).then(resolve);
    return chain;
  });
  return calls;
}
const connection = {
  ig_user_id: "123",
  ig_username: "kiikii.bat",
  login_type: "instagram_login",
  status: "active",
  token_expires_at: "2026-12-01",
  granted_scopes: [],
};
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.unstubAllGlobals());
describe("Instagram analytics boundaries", () => {
  it("keeps missing metrics absent and real zero intact", () => {
    expect(
      metricValues({
        data: [
          { name: "views", values: [{ value: 0 }] },
          { name: "reach", total_value: { value: 5 } },
          { name: "shares", values: [] },
        ],
      }),
    ).toEqual({ views: 0, reach: 5 });
    expect(() => metricValues({})).toThrow();
    expect(safeInstagramLink("https://evil.test/reel/123/")).toBeNull();
    expect(safeInstagramLink("https://www.instagram.com/reel/123/?tracking=x")).toBe(
      "https://www.instagram.com/reel/123/",
    );
  });
  it("refuses redirects, arbitrary paths and raw provider errors without exposing tokens", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("sensitive", { status: 302 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(instagramAnalyticsGet("secret", "123")).rejects.toThrow("HTTP 302");
    expect(fetcher.mock.calls[0][1].redirect).toBe("manual");
    expect(String(fetcher.mock.calls[0][0])).not.toContain("secret");
    await expect(instagramAnalyticsGet("secret", "https://evil.test")).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects another owner before touching storage", async () => {
    await expect(syncInstagramAnalytics("other")).rejects.toThrow();
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("does not call Meta when another caller already claimed the interval", async () => {
    database([connection, null, { last_synced_at: null }, null]);
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(await syncInstagramAnalytics(owner, true, now)).toEqual({ skipped: true });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("records followers without insights permission and never reads followerstar credentials", async () => {
    const calls = database([
      connection,
      null,
      { last_synced_at: null },
      { user_id: owner },
      { page_access_token: "secret" },
      null,
      null,
    ]);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ id: "123", username: "kiikii.bat", followers_count: 1234 }),
        ),
    );
    await expect(syncInstagramAnalytics(owner, true, now)).resolves.toEqual({ synced: true });
    const snapshot = calls.find(
      (c) => c.table === "business_metric_snapshots" && c.method === "upsert",
    )!.args[0] as { values: unknown };
    expect(snapshot.values).toEqual({ "Follower gesamt": 1234 });
    expect(
      calls
        .filter((c) => c.method === "eq" && c.args[0] === "destination")
        .every((c) => c.args[1] === "kiikii"),
    ).toBe(true);
  });
  it("preserves old statistics if profile identity does not match", async () => {
    const calls = database([
      connection,
      null,
      { last_synced_at: null },
      { user_id: owner },
      { page_access_token: "secret" },
      null,
    ]);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(Response.json({ id: "999", username: "wrong", followers_count: 5 })),
    );
    await expect(syncInstagramAnalytics(owner, true, now)).rejects.toThrow("nicht bestätigt");
    expect(calls.some((c) => c.table === "business_metric_snapshots")).toBe(false);
  });
});
