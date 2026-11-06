import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { H3, fetchWithEvent } from "h3";

const stored = vi.hoisted(() =>
  vi.fn(async (_event: Record<string, unknown>, _options?: unknown) => ({ data: null, error: null })),
);
const link = vi.hoisted(() => ({
  id: "11111111-1111-4111-8111-111111111111",
  campaign_id: "22222222-2222-4222-8222-222222222222",
  domain: "https://go.example.com",
  target: "https://example.com/offer",
  active: true,
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: async () => ({ data: true, error: null }),
    from: (table: string) => {
      if (table === "sl_events") return { upsert: stored };
      if (table !== "sl_links") throw Error("Unexpected database table");
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async maybeSingle() {
          return { data: link, error: null };
        },
      };
    },
  },
}));
import { handleSmartlinkRedirect, smartlinkRuntime, visitorHash } from "./smartlinks.server";

const shortPath = `/s/${"a".repeat(32)}`;
const processSecret = "process-fixture-".repeat(3);
const nativeSecret = "binding-fixture-".repeat(3);
const address = "203.0.113.10";
const event = () => stored.mock.calls[0]?.[0] as unknown as Record<string, unknown>;
beforeEach(() => {
  stored.mockClear();
  vi.stubEnv("SMARTLINK_DOMAINS", link.domain);
  vi.stubEnv("SMARTLINK_HASH_SECRET", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Native SmartLink runtime metadata", () => {
  it("keeps hashing through an actual H3 internal subrequest without inventing country", async () => {
    const background: Promise<unknown>[] = [];
    const request = Object.assign(
      new Request(`${link.domain}/bridge`, {
        headers: { "user-agent": "Mozilla/5.0", "cf-ipcountry": "US" },
      }),
      {
        cf: { country: "DE" },
        ip: address,
        runtime: {
          name: "cloudflare",
          cloudflare: { env: { SMARTLINK_HASH_SECRET: nativeSecret } },
        },
        waitUntil: (promise: Promise<unknown>) => {
          background.push(promise);
        },
      },
    );
    let childHasCf: boolean | undefined;
    const app = new H3();
    app.get("/bridge", (e) => fetchWithEvent(e, shortPath));
    app.get(shortPath, (e) => {
      childHasCf = "cf" in e.req;
      return handleSmartlinkRedirect(e.req);
    });
    const response = await app.fetch(request as Request);
    await Promise.all(background);
    expect(childHasCf).toBe(false); // Pinned H3 omits cf but copies runtime/ip/waitUntil.
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(link.target);
    expect(stored).toHaveBeenCalledTimes(1);
    expect(event().visitor_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(event().country).toBe("ZZ");
    expect(JSON.stringify(event())).not.toContain(address);
    expect(JSON.stringify(event())).not.toContain(nativeSecret);
  });

  it("rejects forged forwarded headers and an IP without native Cloudflare runtime", async () => {
    vi.stubEnv("SMARTLINK_HASH_SECRET", processSecret);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const request = Object.assign(
      new Request(link.domain + shortPath, {
        headers: {
          "user-agent": "Mozilla/5.0",
          "cf-connecting-ip": address,
          "x-forwarded-for": address,
          "cf-ipcountry": "DE",
          "x-cloudflare-runtime": "true",
        },
      }),
      { ip: address, runtime: { name: "node" } },
    );
    const response = await handleSmartlinkRedirect(request);
    expect(response.status).toBe(302);
    expect(event()).toMatchObject({ visitor_hash: null, country: "ZZ" });
    expect(warning).toHaveBeenCalledWith(
      "smartlink_visitor_unavailable",
      expect.objectContaining({
        cfPresent: false,
        runtimeCloudflarePresent: false,
        runtimeIpPresent: true,
        cfConnectingIpHeaderPresent: true,
        processSecretConfigured: true,
        nativeEnvSecretConfigured: false,
        trustedIpAvailable: false,
      }),
    );
    const diagnostic = warning.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.values(diagnostic).every((value) => typeof value === "boolean")).toBe(true);
    expect(JSON.stringify(diagnostic)).not.toContain(address);
    expect(JSON.stringify(diagnostic)).not.toContain(processSecret);
  });

  it("does not trust a header IP merely because a Cloudflare runtime marker exists", () => {
    const request = Object.assign(
      new Request(link.domain, {
        headers: { "cf-connecting-ip": address },
      }),
      { runtime: { cloudflare: { env: {} } } },
    );
    expect(smartlinkRuntime(request, processSecret).trusted.ip).toBeUndefined();
  });

  it("retains direct native cf metadata behavior", () => {
    const request = Object.assign(
      new Request(link.domain, {
        headers: { "cf-connecting-ip": address },
      }),
      { cf: { country: "DE" } },
    );
    expect(smartlinkRuntime(request, processSecret).trusted).toEqual({
      ip: address,
      country: "DE",
    });
  });

  it.each([undefined, "short", 123, null])(
    "uses the native binding only when the process secret is invalid: %j",
    async (invalid) => {
      const request = Object.assign(new Request(link.domain), {
        ip: address,
        runtime: { cloudflare: { env: { SMARTLINK_HASH_SECRET: nativeSecret } } },
      });
      const runtime = smartlinkRuntime(request, invalid);
      expect(runtime.readiness.processSecretConfigured).toBe(false);
      expect(runtime.readiness.nativeEnvSecretConfigured).toBe(true);
      expect(await visitorHash(runtime.secret!, "fixture")).toBe(
        await visitorHash(nativeSecret, "fixture"),
      );
    },
  );

  it("preserves the valid process secret to avoid changing existing visitor pseudonyms", () => {
    const request = Object.assign(new Request(link.domain), {
      runtime: { cloudflare: { env: { SMARTLINK_HASH_SECRET: nativeSecret } } },
    });
    expect(smartlinkRuntime(request, processSecret).secret === processSecret).toBe(true);
  });

  it("rejects short native secrets and arbitrary env headers", () => {
    const request = Object.assign(
      new Request(link.domain, {
        headers: { SMARTLINK_HASH_SECRET: nativeSecret },
      }),
      { runtime: { cloudflare: { env: { SMARTLINK_HASH_SECRET: "short" } } } },
    );
    const runtime = smartlinkRuntime(request, "");
    expect(runtime.secret).toBeUndefined();
    expect(runtime.readiness.nativeEnvSecretConfigured).toBe(false);
  });
});
