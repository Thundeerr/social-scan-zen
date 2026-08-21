import { describe, expect, it } from "vitest";
import {
  IG_SCOPES,
  buildAuthorizeUrl,
  callbackUrlForOrigin,
  connectionHealth,
  missingScopes,
  parseCallbackParams,
  redactSecrets,
} from "./instagram-oauth";
import { consumeOAuthState } from "./instagram-oauth.server";

describe("authorize url", () => {
  it("requests exactly the supported permissions", () => {
    const url = new URL(
      buildAuthorizeUrl({ clientId: "123", redirectUri: "https://app.test/cb", state: "s1" }),
    );
    expect(url.origin + url.pathname).toBe("https://www.instagram.com/oauth/authorize");
    expect(url.searchParams.get("scope")).toBe(IG_SCOPES.join(","));
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("s1");
    expect(url.toString()).not.toContain("client_secret");
  });

  it("derives the registered callback url from the origin", () => {
    expect(callbackUrlForOrigin("https://www.instascanner.app")).toBe(
      "https://www.instascanner.app/api/public/instagram/callback",
    );
  });
});

describe("callback parsing", () => {
  it("accepts a complete callback", () => {
    const result = parseCallbackParams(new URLSearchParams("code=AQ123&state=abc"));
    expect(result).toEqual({ ok: true, code: "AQ123", state: "abc" });
  });

  it("reports cancellation without a code", () => {
    const result = parseCallbackParams(new URLSearchParams("error=access_denied"));
    expect(result.ok).toBe(false);
  });

  it("rejects a callback missing the state", () => {
    expect(parseCallbackParams(new URLSearchParams("code=AQ123")).ok).toBe(false);
  });

  it("redacts secrets that a provider error might echo", () => {
    const result = parseCallbackParams(
      new URLSearchParams("error_description=bad code=AQ99&x=1"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toContain("AQ99");
  });
});

describe("redaction", () => {
  it("removes tokens, codes and secrets", () => {
    const dirty = "failed access_token=IGQVJabcdefghijklmnopqrstuvwx client_secret=xyz code=AQ1";
    const clean = redactSecrets(dirty);
    expect(clean).not.toContain("IGQVJabcdefghijklmnopqrstuvwx");
    expect(clean).not.toContain("xyz");
    expect(clean).not.toContain("AQ1");
  });
});

describe("scopes", () => {
  it("detects missing permissions", () => {
    expect(missingScopes(["instagram_business_basic"])).toContain(
      "instagram_business_content_publish",
    );
    expect(missingScopes([...IG_SCOPES])).toEqual([]);
  });
});

describe("connection health", () => {
  const now = Date.parse("2026-01-01T00:00:00Z");
  it("is healthy well before expiry", () => {
    const result = connectionHealth({
      status: "active",
      tokenExpiresAt: "2026-02-20T00:00:00Z",
      now,
    });
    expect(result.healthy).toBe(true);
    expect(result.needsAttention).toBe(false);
  });

  it("blocks when less than six hours remain", () => {
    expect(
      connectionHealth({ status: "active", tokenExpiresAt: "2026-01-01T04:00:00Z", now }).healthy,
    ).toBe(false);
  });

  it("is unhealthy without a connection", () => {
    expect(connectionHealth({ status: null, tokenExpiresAt: null, now }).healthy).toBe(false);
  });
});

// --- one-time state consumption -------------------------------------------

type Row = { state: string; user_id: string; redirect_uri: string; consumed: boolean; exp: number };

function fakeDb(rows: Row[]) {
  return {
    from() {
      const filters: { state?: string; unconsumed?: boolean; after?: number } = {};
      const api = {
        update() {
          return api;
        },
        eq(_col: string, value: string) {
          filters.state = value;
          return api;
        },
        is() {
          filters.unconsumed = true;
          return api;
        },
        gt(_col: string, value: string) {
          filters.after = Date.parse(value);
          return api;
        },
        select() {
          return api;
        },
        async maybeSingle() {
          const row = rows.find(
            (candidate) =>
              candidate.state === filters.state &&
              (!filters.unconsumed || !candidate.consumed) &&
              candidate.exp > (filters.after ?? 0),
          );
          if (!row) return { data: null, error: null };
          row.consumed = true;
          return {
            data: { user_id: row.user_id, redirect_uri: row.redirect_uri },
            error: null,
          };
        },
      };
      return api;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("oauth state consumption", () => {
  const base = (): Row[] => [
    {
      state: "good",
      user_id: "user-1",
      redirect_uri: "https://app.test/cb",
      consumed: false,
      exp: Date.now() + 60_000,
    },
    {
      state: "expired",
      user_id: "user-2",
      redirect_uri: "https://app.test/cb",
      consumed: false,
      exp: Date.now() - 60_000,
    },
  ];

  it("returns the bound operator exactly once", async () => {
    const rows = base();
    const db = fakeDb(rows);
    await expect(consumeOAuthState(db, "good")).resolves.toEqual({
      userId: "user-1",
      redirectUri: "https://app.test/cb",
    });
    // replay of the same state must fail
    await expect(consumeOAuthState(db, "good")).resolves.toBeNull();
  });

  it("rejects expired state", async () => {
    await expect(consumeOAuthState(fakeDb(base()), "expired")).resolves.toBeNull();
  });

  it("rejects unknown / forged state", async () => {
    await expect(consumeOAuthState(fakeDb(base()), "someone-elses")).resolves.toBeNull();
    await expect(consumeOAuthState(fakeDb(base()), "")).resolves.toBeNull();
  });
});
