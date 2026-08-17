import { describe, expect, it } from "vitest";
import {
  evaluateSpend,
  isRetryExhausted,
  nextAttemptAt,
  resolveProviderBaseUrl,
  validateProviderBaseUrl,
  validateQuantity,
  validateTarget,
} from "./action-guard";

describe("validateProviderBaseUrl", () => {
  it("accepts the default endpoint", () => {
    expect(validateProviderBaseUrl(null).ok).toBe(true);
    expect(validateProviderBaseUrl("https://justanotherpanel.com/api/v2").ok).toBe(true);
  });
  it("rejects non-https, private and unlisted hosts", () => {
    expect(validateProviderBaseUrl("http://justanotherpanel.com/api/v2").ok).toBe(false);
    expect(validateProviderBaseUrl("https://127.0.0.1/api").ok).toBe(false);
    expect(validateProviderBaseUrl("https://evil.example.com/api").ok).toBe(false);
    expect(validateProviderBaseUrl("not a url").ok).toBe(false);
  });
});

describe("validateTarget", () => {
  it("accepts an instagram url for the monitored account", () => {
    expect(validateTarget("https://instagram.com/thunderceo", "thunderceo").ok).toBe(true);
    expect(validateTarget("https://www.instagram.com/ThunderCEO/", "thunderceo").ok).toBe(true);
  });
  it("rejects placeholders, other hosts and other accounts", () => {
    expect(validateTarget("https://instagram.com/{username}", "thunderceo").ok).toBe(false);
    expect(validateTarget("https://example.com/thunderceo", "thunderceo").ok).toBe(false);
    expect(validateTarget("https://instagram.com/someoneelse", "thunderceo").ok).toBe(false);
    expect(validateTarget("", "thunderceo").ok).toBe(false);
  });
});

describe("validateQuantity", () => {
  it("enforces whole numbers within the cap", () => {
    expect(validateQuantity(100, 1000).ok).toBe(true);
    expect(validateQuantity(0, 1000).ok).toBe(false);
    expect(validateQuantity(1.5, 1000).ok).toBe(false);
    expect(validateQuantity(5000, 1000).ok).toBe(false);
  });
});

describe("evaluateSpend", () => {
  const base = { ordersToday: 0, ordersThisMonth: 0, dailyCap: 5, monthlyCap: 50 };
  it("passes below the caps", () => {
    expect(evaluateSpend(base).ok).toBe(true);
  });
  it("blocks at the daily and monthly caps", () => {
    expect(evaluateSpend({ ...base, ordersToday: 5 }).ok).toBe(false);
    expect(evaluateSpend({ ...base, ordersThisMonth: 50 }).ok).toBe(false);
  });
  it("treats a cap of 0 as unlimited", () => {
    expect(evaluateSpend({ ...base, dailyCap: 0, ordersToday: 99 }).ok).toBe(true);
  });
});

describe("backoff", () => {
  it("schedules increasing retries then exhausts", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    expect(nextAttemptAt(1, now)).toBe("2026-01-01T00:01:00.000Z");
    expect(nextAttemptAt(2, now)).toBe("2026-01-01T00:05:00.000Z");
    expect(nextAttemptAt(5, now)).toBeNull();
    expect(isRetryExhausted(5)).toBe(true);
    expect(isRetryExhausted(2)).toBe(false);
  });
});

describe("resolveProviderBaseUrl", () => {
  it("falls back to the default", () => {
    expect(resolveProviderBaseUrl("  ")).toContain("justanotherpanel.com");
  });
});
