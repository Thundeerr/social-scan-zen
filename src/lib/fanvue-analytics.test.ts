import { afterEach, describe, expect, it, vi } from "vitest";
import { berlinMidnight, summarizeEarnings, type Earning } from "./fanvue-analytics";
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
import { earningsPages, exchangeFanvue, fanvueGet, fanvueStatus } from "./fanvue-analytics.server";
afterEach(() => vi.unstubAllGlobals());
describe("Fanvue analytics boundaries", () => {
  it("uses Berlin midnight across the DST change", () => {
    expect(berlinMidnight("2026-10-25")).toBe("2026-10-24T22:00:00.000Z");
    expect(berlinMidnight("2026-10-26")).toBe("2026-10-25T23:00:00.000Z");
  });
  it("nets reversals and deductions, excludes app purchases, does not count renewals as new subs", () => {
    const row = (source: string, gross: number, net: number): Earning => ({
      source,
      gross,
      net,
      date: "2026-10-27T12:00:00Z",
      transactionOrderId: source,
    });
    const r = summarizeEarnings(
      [
        row("subscription", 1000, 800),
        row("renewal", 1000, 800),
        row("refund", -1000, -800),
        row("earningsDeduction", 0, -100),
        row("appStore", 9000, 8000),
      ],
      "2026-10-27T00:00:00Z",
      "2026-10-28T00:00:00Z",
    );
    expect(r.gross).toBe(1000);
    expect(r.net).toBe(700);
    expect(r.payments).toBe(1);
    expect(() => summarizeEarnings([row("message", NaN, 0)], "2026-10-27", "2026-10-28")).toThrow();
  });
  it("follows cursors with constant filters; refuses incomplete or repeated pages", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ data: [{ net: 10 }], nextCursor: "next" }))
      .mockResolvedValueOnce(Response.json({ data: [{ net: 20 }], nextCursor: null }));
    vi.stubGlobal("fetch", f);
    expect(await earningsPages("token", "start", "end")).toHaveLength(2);
    expect(new URL(f.mock.calls[1][0]).searchParams.get("cursor")).toBe("next");
    expect(new URL(f.mock.calls[1][0]).searchParams.get("size")).toBe("50");
    f.mockImplementation(() => Promise.resolve(Response.json({ data: [], nextCursor: "loop" })));
    await expect(earningsPages("token", "start", "end")).rejects.toThrow("wiederholen");
    f.mockResolvedValue(Response.json({ data: [] }));
    await expect(earningsPages("token", "start", "end")).rejects.toThrow("Unvollständige");
  });
  it("uses Basic auth and refuses token responses lacking required scopes", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(
        Response.json({
          access_token: "a",
          refresh_token: "r",
          expires_in: 3600,
          scope: "read:self read:insights offline_access",
        }),
      );
    vi.stubGlobal("fetch", f);
    const result = await exchangeFanvue(
      { clientSecret: "secret" },
      {
        grant_type: "authorization_code",
        code: "code",
        code_verifier: "v",
        redirect_uri: "https://example.com",
      },
    );
    expect(result.refreshToken).toBe("r");
    expect(f.mock.calls[0][1].headers.authorization).toMatch(/^Basic /);
    expect(f.mock.calls[0][1].body.has("client_secret")).toBe(false);
    f.mockResolvedValue(
      Response.json({
        access_token: "a",
        refresh_token: "r",
        expires_in: 3600,
        scope: "read:self",
      }),
    );
    await expect(exchangeFanvue({ clientSecret: "secret" }, {})).rejects.toThrow("Leserechte");
  });
  it("does not call arbitrary endpoints or allow another operator", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await expect(fanvueGet("x", "/posts")).rejects.toThrow();
    await expect(fanvueStatus("other")).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });
  it("reports safe token failure categories without leaking provider content", async () => {
    const f = vi.fn().mockResolvedValue(Response.json({ error: "invalid_request", error_description: "SECRET" }, { status: 400 }));
    vi.stubGlobal("fetch", f);
    await expect(exchangeFanvue({ clientSecret: "secret" }, {})).rejects.toThrow("HTTP 400, invalid_request");
    f.mockResolvedValue(Response.json({ error: "SECRET" }, { status: 403 }));
    await expect(exchangeFanvue({ clientSecret: "secret" }, {})).rejects.toThrow("(HTTP 403).");
    f.mockRejectedValue(new TypeError("SECRET"));
    await expect(exchangeFanvue({ clientSecret: "secret" }, {})).rejects.toThrow("Netzwerkverbindung");
    f.mockRejectedValue(new DOMException("SECRET", "TimeoutError"));
    await expect(exchangeFanvue({ clientSecret: "secret" }, {})).rejects.toThrow("Zeitlimit");
  });
});
