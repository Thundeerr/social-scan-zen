import { describe, it, expect } from "vitest";
import {
  buildTransitionKey,
  clampInterval,
  isCooldownActive,
  isPrivateToPublic,
  nextCheckAt,
  readIsPrivate,
  resolveIntervalMinutes,
  retryAt,
  MIN_INTERVAL_MINUTES,
  MAX_INTERVAL_MINUTES,
} from "./transition";
import { extractUsername, isValidUsername, parseUsernameInput, renderTarget } from "./usernames";

const base = {
  status_initialized: true,
  is_private: true,
  last_checked_at: "2026-01-01T00:00:00Z",
};

describe("transition detection", () => {
  it("does not fire on the first successful check (no baseline)", () => {
    expect(
      isPrivateToPublic(
        { status_initialized: false, is_private: null, last_checked_at: null },
        false,
      ),
    ).toBe(false);
    expect(
      isPrivateToPublic(
        { status_initialized: false, is_private: null, last_checked_at: null },
        true,
      ),
    ).toBe(false);
  });

  it("fires exactly on private → public", () => {
    expect(isPrivateToPublic(base, false)).toBe(true);
  });

  it("does not fire on public → public", () => {
    expect(isPrivateToPublic({ ...base, is_private: false }, false)).toBe(false);
  });

  it("does not fire on private → private", () => {
    expect(isPrivateToPublic(base, true)).toBe(false);
  });

  it("does not fire on public → private", () => {
    expect(isPrivateToPublic({ ...base, is_private: false }, true)).toBe(false);
  });

  it("never treats unknown as public", () => {
    expect(isPrivateToPublic({ ...base, is_private: null }, false)).toBe(false);
  });

  it("builds a deterministic key so concurrent runs collapse onto one event", () => {
    expect(buildTransitionKey(base)).toBe(buildTransitionKey({ ...base }));
    expect(buildTransitionKey({ ...base, last_checked_at: null })).toBe(
      "private_to_public:initial",
    );
  });
});

describe("cooldown and scheduling", () => {
  it("suppresses inside the cooldown window and allows outside", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    expect(isCooldownActive("2026-01-01T11:30:00Z", 60, now)).toBe(true);
    expect(isCooldownActive("2026-01-01T10:30:00Z", 60, now)).toBe(false);
    expect(isCooldownActive(null, 60, now)).toBe(false);
  });

  it("clamps intervals into the quota-safe band", () => {
    expect(clampInterval(1)).toBe(MIN_INTERVAL_MINUTES);
    expect(clampInterval(99999)).toBe(MAX_INTERVAL_MINUTES);
    expect(clampInterval(Number.NaN)).toBe(MIN_INTERVAL_MINUTES);
    expect(resolveIntervalMinutes(null, 240)).toBe(240);
    expect(resolveIntervalMinutes(360, 240)).toBe(360);
  });

  it("schedules the next check in UTC ISO form, in the future", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const next = nextCheckAt(180, now, 0);
    expect(next).toBe("2026-01-01T03:00:00.000Z");
    expect(retryAt(now)).toBe("2026-01-01T00:15:00.000Z");
  });
});

describe("is_private extraction", () => {
  it("reads a flat boolean", () => {
    expect(readIsPrivate({ is_private: true })).toBe(true);
    expect(readIsPrivate({ is_private: false })).toBe(false);
  });

  it("reads nested body/data/user payloads", () => {
    expect(readIsPrivate({ body: { is_private: true } })).toBe(true);
    expect(readIsPrivate({ data: { user: { is_private: false } } })).toBe(false);
  });

  it("returns null (an error, never 'public') for missing or invalid values", () => {
    expect(readIsPrivate({ status: "ok" })).toBeNull();
    expect(readIsPrivate({ is_private: "false" })).toBeNull();
    expect(readIsPrivate(null)).toBeNull();
    expect(readIsPrivate("nonsense")).toBeNull();
  });
});

describe("username normalisation", () => {
  it("accepts handles with and without a leading @ and full URLs", () => {
    expect(extractUsername("@Soneva")).toBe("Soneva");
    expect(extractUsername("https://www.instagram.com/soneva/?hl=en")).toBe("soneva");
  });

  it("rejects empty and invalid input", () => {
    expect(extractUsername("   ")).toBe("");
    expect(isValidUsername("")).toBe(false);
    expect(isValidUsername("bad name")).toBe(false);
    expect(isValidUsername(".lead")).toBe(false);
    expect(isValidUsername("dou..ble")).toBe(false);
    expect(isValidUsername("ok.handle_1")).toBe(true);
  });

  it("dedupes case-insensitively and reports invalid tokens", () => {
    const parsed = parseUsernameInput("@Soneva soneva ..bad.. valid_two");
    expect(parsed.valid.map((v) => v.normalized)).toEqual(["soneva", "valid_two"]);
    expect(parsed.duplicates).toEqual(["soneva"]);
    expect(parsed.invalid.length).toBeGreaterThan(0);
  });

  it("renders action targets from the template", () => {
    expect(renderTarget("https://instagram.com/{username}", "soneva")).toBe(
      "https://instagram.com/soneva",
    );
  });
});
