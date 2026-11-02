import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AdminClient } from "./instagram-oauth.server";
import { completeInstagramConnection } from "./instagram-oauth.server";
import { IG_SCOPES } from "./instagram-oauth";
const write = vi.fn(),
  mapping = vi.fn(),
  fetchMock = vi.fn();
function db(destination: string, existing: string | null = null, stateOptions = {}) {
  return {
    from(table: string) {
      const chain = {
        update: () => chain,
        eq: () => chain,
        is: () => chain,
        gt: () => chain,
        select: () => chain,
        maybeSingle: async () => ({
          data:
            table === "ig_oauth_states"
              ? {
                  user_id: "owner",
                  redirect_uri: "https://instascanner.app/api/public/instagram/callback",
                  destination,
                  ...stateOptions,
                }
              : existing
                ? { ig_user_id: existing }
                : null,
          error: null,
        }),
        upsert: write,
        then: (resolve: (v: unknown) => void) => {
          mapping(table);
          resolve({ error: null });
        },
      };
      return chain;
    },
  } as unknown as AdminClient;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("INSTAGRAM_APP_ID", "mock");
  vi.stubEnv("INSTAGRAM_APP_SECRET", "mock");
  vi.stubGlobal("fetch", fetchMock);
  write.mockResolvedValue({ error: null });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
function profile(username: string, id = "kiikii-id") {
  for (const body of [
    { access_token: "short", permissions: [...IG_SCOPES] },
    { access_token: "long", expires_in: 5184000 },
    { username, user_id: id },
  ])
    fetchMock.mockResolvedValueOnce(Response.json(body));
}
it("binds OAuth to Kiikii and upserts only its destination", async () => {
  profile("kiikii.bat");
  expect((await completeInstagramConnection(db("kiikii"), { code: "c", state: "s" })).ok).toBe(
    true,
  );
  expect(write).toHaveBeenCalledWith(
    expect.objectContaining({ destination: "kiikii", user_id: "owner", ig_user_id: "kiikii-id" }),
    { onConflict: "user_id,destination" },
  );
  expect(mapping).toHaveBeenCalledWith("model_alert_channels");
});
it("rejects a different Instagram identity before writing any connection", async () => {
  profile("followerstarteam");
  expect((await completeInstagramConnection(db("kiikii"), { code: "c", state: "s" })).ok).toBe(
    false,
  );
  expect(write).not.toHaveBeenCalled();
});
it("does not overwrite FollowerStar with a different account", async () => {
  profile("kiikii.bat");
  expect(
    (
      await completeInstagramConnection(db("followerstar", "followerstar-id"), {
        code: "c",
        state: "s",
      })
    ).ok,
  ).toBe(false);
  expect(write).not.toHaveBeenCalled();
});
it("rejects unknown OAuth destinations before token exchange", async () => {
  expect((await completeInstagramConnection(db("unknown"), { code: "c", state: "s" })).ok).toBe(
    false,
  );
  expect(fetchMock).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
});

it("does not replace the publishing token when messaging permission is denied", async () => {
  profile("kiikii.bat");
  const result = await completeInstagramConnection(
    db("kiikii", "kiikii-id", {
      dm_redirect: true,
      requested_scopes: [...IG_SCOPES, "instagram_business_manage_messages"],
    }),
    { code: "c", state: "s" },
  );
  expect(result.ok).toBe(false);
  expect(write).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("refuses a DM connection when Meta omits the granted scopes", async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ access_token: "short" }));
  const result = await completeInstagramConnection(db("kiikii", null, { dm_redirect: true }), {
    code: "c",
    state: "s",
  });
  expect(result.ok).toBe(false);
  expect(write).not.toHaveBeenCalled();
});
it("preserves requested insights and messaging permissions and returns to DM setup", async () => {
  const scopes = [
    ...IG_SCOPES,
    "instagram_business_manage_messages",
    "instagram_business_manage_insights",
  ];
  for (const body of [
    { access_token: "short", permissions: scopes },
    { access_token: "long", expires_in: 5184000 },
    { username: "kiikii.bat", user_id: "kiikii-id" },
  ])
    fetchMock.mockResolvedValueOnce(Response.json(body));
  const result = await completeInstagramConnection(
    db("kiikii", "kiikii-id", { dm_redirect: true, requested_scopes: scopes }),
    { code: "c", state: "s" },
  );
  expect(result).toMatchObject({ ok: true, dmRedirect: true, destination: "kiikii" });
  expect(write).toHaveBeenCalledWith(
    expect.objectContaining({ granted_scopes: scopes }),
    expect.anything(),
  );
});
