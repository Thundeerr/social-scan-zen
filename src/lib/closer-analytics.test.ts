import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
import { parseCloserAnalytics, CLOSER_ACCOUNT_ID } from "./closer-analytics";
import { fetchCloserAnalytics, closerStatus, configureCloser } from "./closer-analytics.server";
const payload = () => ({
  columns: ["Metric", "Last 7 days"],
  rows: [
    { name: "Conversations raw", values: ["1,234"] },
    { name: "Conversations charged", values: ["900 (72.93% of 1,234)"] },
    { name: "CTA phase started", values: ["0 (0% of 900)"] },
    { name: "Shared CTA link", values: ["0"] },
    { name: "Conversions from CTA link shared", values: ["-"] },
    { name: "Conversions", values: ["0"] },
  ],
});
afterEach(() => vi.unstubAllGlobals());
describe("Closer analytics", () => {
  it("extracts counts, never percentages or denominator; missing is not zero", () => {
    const p = parseCloserAnalytics(payload());
    expect(p["Gespräche gesamt"]).toBe(1234);
    expect(p["Berechnete Gespräche"]).toBe(900);
    expect(p["CTA gestartet"]).toBe(0);
    expect(p["Conversions nach Link (Closer)"]).toBeUndefined();
  });
  it("rejects error payloads, partial responses and ambiguous formats", () => {
    expect(() => parseCloserAnalytics({ success: false, error: "private" })).toThrow();
    const p = payload();
    p.rows.pop();
    expect(() => parseCloserAnalytics(p)).toThrow();
    const bad = payload();
    bad.rows[0].values = ["1.234"];
    expect(() => parseCloserAnalytics(bad)).toThrow();
  });
  it("scopes to the Kiikii account and fixed Berlin date range", async () => {
    const f = vi.fn().mockResolvedValue(Response.json(payload()));
    vi.stubGlobal("fetch", f);
    await fetchCloserAnalytics("secret", "2026-10-21", "2026-10-27");
    const url = new URL(f.mock.calls[0][0]);
    expect(url.origin).toBe("https://x.cupidbotofm.ai");
    expect(url.searchParams.get("viewingAccountID")).toBe(CLOSER_ACCOUNT_ID);
    expect(url.searchParams.get("app")).toBe("instagram");
    expect(url.searchParams.get("viewingApps")).toBe("instagram");
    expect(url.searchParams.get("timezone")).toBe("Europe/Berlin");
    expect(url.searchParams.has("lastDays")).toBe(false);
  });
  it("never follows redirects or exposes raw provider/network errors", async () => {
    const f = vi.fn().mockResolvedValue(new Response("secret", { status: 302 }));
    vi.stubGlobal("fetch", f);
    await expect(fetchCloserAnalytics("secret", "2026-10-21", "2026-10-27")).rejects.toThrow(
      "HTTP 302",
    );
    expect(f.mock.calls[0][1].redirect).toBe("manual");
    f.mockRejectedValue(new Error("https://example?accessToken=secret"));
    await expect(fetchCloserAnalytics("secret", "a", "b")).rejects.toThrow(
      "gerade nicht erreichbar",
    );
  });
  it("rejects another user before reading or storing credentials", async () => {
    await expect(closerStatus("other")).rejects.toThrow("Nur für");
    await expect(configureCloser("other", "secret")).rejects.toThrow("Nur für");
  });
});
