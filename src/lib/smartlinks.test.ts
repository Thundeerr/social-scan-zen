import { describe, it, expect, vi } from "vitest";
import {
  classifyHit,
  csv,
  destination,
  smartlinkAction,
  renderDraft,
  visitorEstimate,
} from "./smartlinks";
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
import { domains, redirectRequest, visitorHash } from "./smartlinks.server";
const slug = "a".repeat(32),
  base = "https://go.example.com";
const link = {
  id: crypto.randomUUID(),
  campaign_id: crypto.randomUUID(),
  domain: base,
  target: "https://example.com/offer?utm_source=instagram",
  active: true,
};
function deps() {
  return {
    domains: [base],
    lookup: vi.fn(async () => link),
    rate: vi.fn(async () => true),
    record: vi.fn(async (_event: Record<string, unknown>) => {}),
    secret: "secret".repeat(8),
    trusted: { ip: "203.0.113.1", country: "DE" },
    now: () => new Date("2026-11-02T12:00:00Z"),
  };
}
describe("Visitor coverage", () => {
  it("does not report zero visitors for human clicks without hashes", () => {
    expect(visitorEstimate({ human: 16, unique: 0, unidentified: 16 })).toMatchObject({
      state: "unavailable",
      value: "Nicht verfügbar",
    });
  });
  it("labels partially identified traffic as a lower bound", () => {
    expect(visitorEstimate({ human: 16, unique: 3, unidentified: 10 })).toMatchObject({
      state: "partial",
      value: "≥ 3",
    });
    expect(visitorEstimate({ human: 16, unique: 3, unidentified: 10 }).hint).toContain("6 von 16");
  });
  it("distinguishes a genuinely empty period from missing coverage", () => {
    expect(visitorEstimate({ human: 0, unique: 0, unidentified: 0 })).toMatchObject({
      state: "complete",
      value: 0,
    });
    expect(visitorEstimate({ human: 16, unique: 5, unidentified: 0 })).toMatchObject({
      state: "complete",
      value: 5,
    });
  });
  it.each([
    { human: 16, unique: 0 },
    { human: 16, unique: 0, unidentified: 0 },
    { human: 16, unique: 8, unidentified: 10 },
    { human: 16, unique: 0, unidentified: 17 },
    { human: 16, unique: NaN, unidentified: 0 },
  ])("withholds inconsistent or legacy coverage data: %j", (data) => {
    expect(visitorEstimate(data).state).toBe("unavailable");
  });
});
describe("SmartLink validation", () => {
  it.each([
    "javascript:alert(1)",
    "http://example.com",
    "https://127.0.0.1",
    "https://2130706433",
    "https://[::1]",
    "https://user:pass@example.com",
    "https://example.com:444",
    "https://test.local",
    "https://localhost",
  ])("rejects unsafe destination %s", (u) => expect(() => destination(u)).toThrow());
  it("normalizes HTTPS and rejects malformed domains", () => {
    expect(destination("https://example.com")).toBe("https://example.com/");
    expect(domains("https://go.example.com, https://go.example.com/")).toEqual([base]);
    expect(() => domains("https://example.com/path")).toThrow();
  });
  it("enforces batch and action limits", () => {
    const action = {
      action: "generate",
      campaign: crypto.randomUUID(),
      request_id: crypto.randomUUID(),
      target: link.target,
      domain: base,
      count: 1000,
    };
    expect(smartlinkAction.safeParse(action).success).toBe(true);
    expect(smartlinkAction.safeParse({ ...action, count: 1001 }).success).toBe(false);
    expect(smartlinkAction.safeParse({ action: "send" }).success).toBe(false);
  });
  it("prevents spreadsheet formulas and escapes CSV", () => {
    expect(csv([{ x: "=SUM(1)", y: 'a,"b"\nc' }], ["x", "y"])).toContain('"\'=SUM(1)"');
    expect(csv([{ x: 'a,"b"' }], ["x"])).toContain('"a,""b"""');
  });
  it("renders literal recipient names safely", () =>
    expect(renderDraft("Hi {{name}}: {{link}}", "$&", "https://a.b")).toBe("Hi $&: https://a.b"));
});
describe("Redirect and tracking", () => {
  it("uses a transparent no-cache 302, strips referrer paths and records no raw IP/UA", async () => {
    const d = deps();
    const r = await redirectRequest(
      new Request(base + "/s/" + slug, {
        headers: {
          "user-agent": "Mozilla/5.0 (iPhone; Mobile)",
          referer: "https://instagram.com/private?secret=abc",
        },
      }),
      d,
    );
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe(link.target);
    expect(r.headers.get("cache-control")).toContain("no-store");
    expect(r.headers.has("set-cookie")).toBe(false);
    const event = d.record.mock.calls[0][0] as Record<string, unknown>;
    expect(event.referrer).toBe("instagram.com");
    expect(event.kind).toBe("human");
    expect(event.visitor_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(event)).not.toContain("203.0.113");
    expect(JSON.stringify(event)).not.toContain("Mozilla");
  });
  it("separates bots, previews and unknown traffic", () => {
    expect(
      classifyHit(new Request(base, { headers: { "user-agent": "facebookexternalhit/1.1" } })).kind,
    ).toBe("preview");
    expect(classifyHit(new Request(base, { headers: { "user-agent": "curl/8" } })).kind).toBe(
      "bot",
    );
    expect(classifyHit(new Request(base)).kind).toBe("unknown");
  });
  it("returns the same target to previews and humans, HEAD has no body", async () => {
    const d = deps();
    const r = await redirectRequest(new Request(base + "/s/" + slug, { method: "HEAD" }), d);
    expect(r.headers.get("location")).toBe(link.target);
    expect(await r.text()).toBe("");
    expect((d.record.mock.calls[0][0] as Record<string, unknown>).kind).toBe("preview");
  });
  it("does not trust forged geo or forwarded IP headers", async () => {
    const d = { ...deps(), trusted: undefined };
    await redirectRequest(
      new Request(base + "/s/" + slug, {
        headers: {
          "cf-ipcountry": "US",
          "x-forwarded-for": "1.2.3.4",
          "user-agent": "Mozilla/5.0",
        },
      }),
      d,
    );
    expect(d.record.mock.calls[0][0]).toMatchObject({ country: "ZZ", visitor_hash: null });
  });
  it("returns 404/410/405/429/503 for invalid paths, disabled links, method, limits and outage", async () => {
    expect((await redirectRequest(new Request(base + "/s/nope"), deps())).status).toBe(404);
    expect(
      (await redirectRequest(new Request("https://evil.example/s/" + slug), deps())).status,
    ).toBe(404);
    expect(
      (
        await redirectRequest(new Request(base + "/s/" + slug), {
          ...deps(),
          lookup: async () => null,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await redirectRequest(new Request(base + "/s/" + slug), {
          ...deps(),
          lookup: async () => ({ ...link, active: false }),
        })
      ).status,
    ).toBe(410);
    expect(
      (await redirectRequest(new Request(base + "/s/" + slug, { method: "POST" }), deps())).status,
    ).toBe(405);
    expect(
      (
        await redirectRequest(new Request(base + "/s/" + slug), {
          ...deps(),
          rate: async () => false,
        })
      ).status,
    ).toBe(429);
    expect(
      (
        await redirectRequest(new Request(base + "/s/" + slug), {
          ...deps(),
          lookup: async () => {
            throw Error("offline");
          },
        })
      ).status,
    ).toBe(503);
  });
  it("keeps redirect working when tracking fails and schedules background work", async () => {
    let work: Promise<unknown> | undefined;
    const r = await redirectRequest(new Request(base + "/s/" + slug), {
      ...deps(),
      waitUntil: (p) => {
        work = p;
      },
      record: async () => {
        throw Error("offline");
      },
    });
    expect(r.status).toBe(302);
    await work;
  });
  it("reports missing visitor prerequisites as booleans without leaking sensitive values", async () => {
    const onUnidentifiedHuman = vi.fn();
    const d = { ...deps(), secret: "too-short-secret", onUnidentifiedHuman };
    const r = await redirectRequest(
      new Request(base + "/s/" + slug, {
        headers: { "user-agent": "Mozilla/5.0" },
      }),
      d,
    );
    expect(r.status).toBe(302);
    expect(onUnidentifiedHuman).toHaveBeenCalledWith({
      secretConfigured: false,
      trustedIpAvailable: true,
      trustedCountryAvailable: true,
    });
    expect(d.record.mock.calls[0][0].visitor_hash).toBeNull();
    const serialized = JSON.stringify(onUnidentifiedHuman.mock.calls);
    expect(serialized).not.toContain("203.0.113.1");
    expect(serialized).not.toContain("too-short-secret");
  });
  it("rejects stored redirect loops", async () => {
    expect(
      (
        await redirectRequest(new Request(base + "/s/" + slug), {
          ...deps(),
          lookup: async () => ({ ...link, target: base + "/s/" + slug }),
        })
      ).status,
    ).toBe(410);
  });
  it("HMAC is stable within scope and rotates with scope", async () => {
    expect(await visitorHash("s", "day1|campaign1|ip")).toBe(
      await visitorHash("s", "day1|campaign1|ip"),
    );
    expect(await visitorHash("s", "day2|campaign1|ip")).not.toBe(
      await visitorHash("s", "day1|campaign1|ip"),
    );
  });
});
