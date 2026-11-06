import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DM_LINK,
  DM_REPLIES,
  DM_SCOPE,
  KIIKII_ID,
  isOptOut,
  websiteDmEvents,
} from "./kiikii-dm-redirect";
const mock = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: mock }));
import {
  deliverWebsiteReply,
  ingestWebsiteDm,
  redirectConnectionReady,
} from "./kiikii-dm-redirect.server";
const now = Date.now();
const event = (patch = {}) => ({
  sender: { id: "20" },
  recipient: { id: KIIKII_ID },
  timestamp: now,
  message: { mid: "unique-mid", text: "hey" },
  ...patch,
});
const payload = (e = event()) => ({
  object: "instagram",
  entry: [{ id: KIIKII_ID, messaging: [e] }],
});
const connection = () => ({
  ig_user_id: KIIKII_ID,
  ig_username: "kiikii.bat",
  page_access_token: "secret-test-token",
  status: "active",
  granted_scopes: [DM_SCOPE],
  token_expires_at: new Date(Date.now() + 86400000).toISOString(),
});
const updates: unknown[] = [];
function query(data: unknown, error: unknown = null) {
  const q = {
    select: vi.fn(),
    eq: vi.fn(),
    update: vi.fn(),
    maybeSingle: vi.fn(),
    then: (resolve: (r: unknown) => unknown) => Promise.resolve({ data, error }).then(resolve),
  };
  q.select.mockReturnValue(q);
  q.eq.mockReturnValue(q);
  q.update.mockImplementation((v) => {
    updates.push(v);
    return q;
  });
  q.maybeSingle.mockResolvedValue({ data, error });
  return q;
}
beforeEach(() => {
  vi.resetAllMocks();
  updates.length = 0;
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());
describe("website reply content and intake", () => {
  it("has 30 distinct short messages with ten URLs for the same chat and an explicit IG boundary", () => {
    expect(DM_REPLIES).toHaveLength(30);
    expect(new Set(DM_REPLIES).size).toBe(30);
    const links = new Set<string>();
    for (const text of DM_REPLIES) {
      expect(text.split(DM_LINK)).toHaveLength(2);
      const urls = text.match(/https:\/\/\S+/g) ?? [];
      expect(urls).toHaveLength(1);
      const url = new URL(urls[0]!);
      expect(url.origin).toBe(DM_LINK);
      expect(url.pathname).toBe("/");
      expect(url.hash).toBe("");
      expect([...url.searchParams.keys()]).toEqual(["via"]);
      expect(url.searchParams.get("via")).toMatch(/^[a-z]+$/);
      links.add(url.href);
      expect(text).toMatch(/IG|insta/);
      expect(text).toMatch(/don't|no |not /);
      expect(text.length).toBeLessThan(300);
    }
    expect(links.size).toBe(10);
  });
  it("accepts inbound texts, images and stop, without keeping message bodies", () => {
    expect(websiteDmEvents(payload(), now)).toHaveLength(1);
    const e = websiteDmEvents(payload(event({ message: { mid: "stop", text: "STOP!" } })), now)[0];
    expect(e.stop).toBe(true);
    expect(e).not.toHaveProperty("text");
    expect(
      websiteDmEvents(
        payload(event({ message: { mid: "img", attachments: [{ type: "image" }] } })),
        now,
      ),
    ).toHaveLength(1);
  });
  it.each([
    { message: { mid: "m", text: "hey", is_echo: true } },
    { message: { mid: "m", text: "hey", is_deleted: true } },
    { message: { mid: "m", text: "hey", is_unsupported: true } },
    { message: { mid: "m" } },
    { recipient: { id: "999" } },
    { sender: { id: KIIKII_ID } },
    { timestamp: now - 86400000 },
    { timestamp: now + 600000 },
    { timestamp: undefined },
    { message: undefined, read: { mid: "m" } },
  ])("does not send for unsafe/non-message events %j", (patch) =>
    expect(websiteDmEvents(payload(event(patch)), now)).toEqual([]),
  );
  it("does not redirect FollowerStar messages", () => {
    const p = payload();
    p.entry[0].id = "17841473861037386";
    expect(websiteDmEvents(p, now)).toEqual([]);
  });
  it("recognizes explicit opt-outs without treating casual text as opt-out", () => {
    expect(isOptOut("don't message me")).toBe(true);
    expect(isOptOut("keine nachrichten mehr")).toBe(true);
    expect(isOptOut("i can't stop playing overwatch")).toBe(false);
  });
  it.each([
    "STOP 🖤", "Stop! ❤️‍🔥", "🫶🏿 STOP", "please stop messaging me",
    "Please, don't message me!", "Don’t message me, please 🖤",
    "Bitte keine Nachrichten mehr", "schreib mir bitte nicht mehr!",
    "Keine Nachrichten mehr, bitte.", "ＳＴＯＰ！", "stop\nplease", "SToPP 🖤",
  ])("honors decorated or polite opt-out %s", (text) => {
    expect(isOptOut(text)).toBe(true);
    expect(websiteDmEvents(payload(event({ message: { mid: "opt-out", text } })), now)[0].stop).toBe(true);
  });
  it.each([
    "", "🖤", "please", "i can't stop playing overwatch", "don't stop messaging me",
    "please don't stop", "nonstop", "stop playing 🖤", "stop 🖤 playing",
    "how do I unsubscribe?", "stop messaging me about overwatch", "unstoppable 🖤",
  ])("does not turn an ordinary sentence into an opt-out: %s", (text) => {
    expect(isOptOut(text)).toBe(false);
  });
});
describe("safe sending", () => {
  it("requires the exact Kiikii connection, permission and fresh token", () => {
    expect(redirectConnectionReady(connection())).toBe(true);
    expect(redirectConnectionReady({ ...connection(), granted_scopes: [] })).toBe(false);
    expect(redirectConnectionReady({ ...connection(), ig_user_id: "99" })).toBe(false);
    expect(redirectConnectionReady({ ...connection(), token_expires_at: "2020-01-01" })).toBe(
      false,
    );
  });
  it("sends the fixed message once through the official endpoint", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ message_id: "meta-mid" }));
    expect((await deliverWebsiteReply("secret", "20", DM_REPLIES[0])).status).toBe("sent");
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe(`https://graph.instagram.com/v25.0/${KIIKII_ID}/messages`);
    expect(JSON.parse(init!.body as string)).toEqual({
      recipient: { id: "20" },
      message: { text: DM_REPLIES[0] },
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
  it("does not retry timeouts or expose error body/token", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("secret"));
    const result = await deliverWebsiteReply("secret", "20", DM_REPLIES[0]);
    expect(result.status).toBe("uncertain");
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("records only safe error codes on rejection", async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ error: { code: 190, message: "secret" } }, { status: 400 }),
    );
    expect(await deliverWebsiteReply("secret", "20", "hi")).toEqual({
      status: "failed",
      error_code: "meta_190",
      provider_message_id: null,
    });
  });
  it("never calls Meta while paused or without permission", async () => {
    mock.from.mockReturnValue(query({ user_id: "owner", mode: "off" }));
    await ingestWebsiteDm(payload());
    expect(fetch).not.toHaveBeenCalled();
    mock.from.mockImplementation((table) =>
      query(
        table === "ig_dm_redirect_settings"
          ? { user_id: "owner", mode: "live" }
          : { ...connection(), granted_scopes: [] },
      ),
    );
    await ingestWebsiteDm(payload());
    expect(fetch).not.toHaveBeenCalled();
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("reserves durably before sending and skips duplicates/cooldowns", async () => {
    mock.from.mockImplementation((table) =>
      query(
        table === "ig_dm_redirect_settings"
          ? { user_id: "owner", mode: "live" }
          : table === "ig_connections"
            ? connection()
            : null,
      ),
    );
    mock.rpc
      .mockResolvedValueOnce({ data: { send: true, variant: 2 }, error: null })
      .mockResolvedValue({ data: { duplicate: true }, error: null });
    vi.mocked(fetch).mockImplementation(async () => {
      expect(mock.rpc).toHaveBeenCalled();
      return Response.json({ message_id: "id" });
    });
    await ingestWebsiteDm(payload());
    await ingestWebsiteDm(payload());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(updates).toEqual([expect.objectContaining({ status: "sent" })]);
    expect(JSON.stringify(mock.rpc.mock.calls)).not.toContain('"hey"');
  });
  it("never sends if reservation storage fails", async () => {
    mock.from.mockImplementation((table) =>
      query(
        table === "ig_dm_redirect_settings" ? { user_id: "owner", mode: "live" } : connection(),
      ),
    );
    mock.rpc.mockResolvedValue({ data: null, error: "db error" });
    await expect(ingestWebsiteDm(payload())).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("test mode resolves actual Meta identity and ignores every other account", async () => {
    mock.from.mockImplementation((table) =>
      query(
        table === "ig_dm_redirect_settings"
          ? { user_id: "owner", mode: "test", test_username: "user_diary01" }
          : connection(),
      ),
    );
    vi.mocked(fetch).mockResolvedValue(Response.json({ username: "someone_else" }));
    await ingestWebsiteDm(payload());
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][1]?.method).toBe("GET");
  });
});
