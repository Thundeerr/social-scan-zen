import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import {
  captionTriggers,
  commentTrigger,
  websiteCommentEvents,
  HEARTS,
  COMMENT_SCOPE,
} from "./kiikii-comment-replies";
import { DM_SCOPE, DM_LINK, KIIKII_ID } from "./kiikii-dm-redirect";
const mock = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: mock }));
import { commentOperator, ingestWebsiteComments } from "./kiikii-comment-replies.server";
import { dmWebhook } from "./reel-inbox-dm.server";

const now = Date.now();
const event = (patch = {}) => ({
  id: "123",
  from: { id: "20", username: "user_diary01" },
  media: { id: "456" },
  text: "🖤",
  ...patch,
});
const payload = (value = event()) => ({
  object: "instagram",
  entry: [{ id: KIIKII_ID, time: now / 1000, changes: [{ field: "comments", value }] }],
});
function query(data: unknown, error: unknown = null) {
  const q: any = { then: (ok: any) => Promise.resolve({ data, error }).then(ok) };
  for (const method of ["select", "eq", "update", "order", "limit"]) q[method] = vi.fn(() => q);
  q.maybeSingle = vi.fn().mockResolvedValue({ data, error });
  return q;
}
const c = () => ({
  ig_user_id: KIIKII_ID,
  ig_username: "kiikii.bat",
  page_access_token: "test-secret",
  granted_scopes: [DM_SCOPE, COMMENT_SCOPE],
  token_expires_at: new Date(now + 86400000).toISOString(),
  status: "active",
});
const verified = (patch = {}) => ({
  ...event(),
  timestamp: new Date(now).toISOString(),
  hidden: false,
  ...patch,
});
const media = (patch = {}) => ({
  id: "456",
  owner: { id: KIIKII_ID },
  permalink: "https://www.instagram.com/reel/Test123/",
  caption: "cute 😭",
  ...patch,
});
let cfg: any, dm: any, conn: any, receipt: unknown, dbError: unknown;
function setup() {
  mock.from.mockImplementation((table) =>
    query(
      table === "ig_dm_redirect_settings"
        ? dm
        : table === "ig_comment_redirect_settings"
          ? cfg
          : table === "ig_connections"
            ? conn
            : receipt,
      dbError,
    ),
  );
  mock.rpc.mockResolvedValue({ data: { send: true, variant: 2 }, error: null });
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/me?"))
      return Response.json({ user_id: KIIKII_ID, id: "28348803094791726", username: "kiikii.bat" });
    if (url.includes("/123?")) return Response.json(verified());
    if (url.includes("/456?")) return Response.json(media());
    if (url.endsWith("/messages")) return Response.json({ message_id: "sent-private-reply" });
    throw new Error("Unexpected network operation");
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", vi.fn());
  vi.stubEnv("INSTAGRAM_WEBHOOK_APP_SECRET", "test-secret");
  cfg = { mode: "test", activated_at: new Date(now - 60000).toISOString() };
  dm = { user_id: "owner", mode: "live", test_username: "user_diary01" };
  conn = c();
  receipt = null;
  dbError = null;
  setup();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const sends = () => vi.mocked(fetch).mock.calls.filter(([u]) => String(u).endsWith("/messages"));

describe("comment CTA matching", () => {
  it.each([...HEARTS, "<3", "<333", "< 3", "&lt;3", "❤️‍🔥", "❤️‍🩹", "🫶🏿", "love this 🖤"])(
    "recognizes %s",
    (text) => {
      expect(commentTrigger(text)).toBe("heart");
    },
  );
  it.each(["cute", "<30", "3", "😭", "👀", "🤭", "🦇", "STOP", "link please"])(
    "ignores unsolicited trigger %s",
    (text) => {
      expect(commentTrigger(text, "thats me btw 😭 Oooopsss 🤭")).toBeNull();
    },
  );
  it("reads explicit future caption CTAs, preserving word boundaries", () => {
    expect(captionTriggers("wanna talk? comment CHAT and i’ll send my link 🦇")).toEqual(["chat"]);
    expect(commentTrigger("chat!", "comment CHAT for my link")).toBe("caption_cta");
    expect(commentTrigger("chatbot", "comment CHAT for my link")).toBeNull();
    expect(commentTrigger("🦇", "drop a 🦇 and i’ll send the link")).toBe("caption_cta");
    expect(commentTrigger("Bat!", "comment “BAT” for my chat")).toBe("caption_cta");
    expect(commentTrigger("stop", "comment “STOP”")).toBeNull();
    expect(captionTriggers("comment “<3” and i’ll send u a dm")).toEqual(["<3"]);
    expect(commentTrigger("a+b", 'comment "a+b"')).toBe("caption_cta");
  });
  it("accepts both documented webhook shapes, omitting raw comment text", () => {
    expect(websiteCommentEvents(payload(), now)).toEqual([
      { comment: "123", sender: "20", username: "user_diary01", media: "456" },
    ]);
    expect(
      websiteCommentEvents(
        { object: "instagram", entry: [{ id: KIIKII_ID, field: "comments", value: event() }] },
        now,
      ),
    ).toHaveLength(1);
  });
  it.each([
    { parent_id: "9" },
    { from: { id: KIIKII_ID, username: "kiikii.bat" } },
    { media: { id: "456", media_product_type: "LIVE" } },
    { media: { id: "456", media_product_type: "STORY" } },
    { from: null },
    { id: "invalid" },
  ])("ignores out of scope events %j", (patch) => {
    expect(websiteCommentEvents(payload(event(patch)), now)).toEqual([]);
  });
  it("ignores other receivers and stale notification times", () => {
    const p = payload();
    p.entry[0].id = "17841473861037386";
    expect(websiteCommentEvents(p, now)).toEqual([]);
    p.entry[0].id = KIIKII_ID;
    p.entry[0].time -= 90000;
    expect(websiteCommentEvents(p, now)).toEqual([]);
  });
});

describe("comment private delivery", () => {
  it("handles Meta's live node response with username-only author and login-scoped media owner", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json(verified({ from: { username: "user_diary01" } })))
      .mockResolvedValueOnce(Response.json(media({ owner: { id: "28348803094791726" } })));
    await ingestWebsiteComments(payload());
    expect(sends()).toHaveLength(1);
    expect(mock.rpc).toHaveBeenCalledWith(
      "ig_comment_redirect_reserve",
      expect.objectContaining({ p_sender: "20", p_username: "user_diary01" }),
    );
  });
  it("uses recipient.comment_id and the approved website reply after a durable reservation", async () => {
    await ingestWebsiteComments(payload());
    expect(mock.rpc).toHaveBeenCalledWith(
      "ig_comment_redirect_reserve",
      expect.objectContaining({ p_sender: "20", p_trigger: true }),
    );
    expect(sends()).toHaveLength(1);
    const body = JSON.parse(sends()[0][1]!.body as string);
    expect(body.recipient).toEqual({ comment_id: "123" });
    expect(body.message.text).toContain(DM_LINK);
    expect(mock.rpc.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(fetch).mock.invocationCallOrder[2],
    );
  });
  it("reads a future caption to match an additional emoji", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json(verified({ text: "🦇" })))
      .mockResolvedValueOnce(Response.json(media({ caption: "leave a 🦇 for my chat link" })))
      .mockResolvedValueOnce(Response.json({ message_id: "sent" }));
    await ingestWebsiteComments(payload(event({ text: "🦇" })));
    expect(sends()).toHaveLength(1);
  });
  it.each([
    { timestamp: new Date(now - 86400000).toISOString() },
    { timestamp: new Date(now - 600000).toISOString() },
    { timestamp: "invalid" },
    { parent_id: "8" },
    { hidden: true },
    { from: { id: "99", username: "other" } },
    { media: { id: "999" } },
    { text: "cute 😭" },
  ])("refetches and rejects ineligible actual comments %j", async (patch) => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(verified(patch)));
    await ingestWebsiteComments(payload());
    expect(sends()).toHaveLength(0);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it.each([
    { owner: { id: "999" } },
    { permalink: "https://www.instagram.com/stories/kiikii.bat/456/" },
  ])("requires own feed/reel media %j", async (patch) => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json(verified()))
      .mockResolvedValueOnce(Response.json(media(patch)));
    await ingestWebsiteComments(payload());
    expect(sends()).toHaveLength(0);
  });
  it("never sends again for duplicate/cooldown/opted-out reservations", async () => {
    for (const data of [{ duplicate: true }, { send: false }]) {
      mock.rpc.mockResolvedValue({ data, error: null });
      await ingestWebsiteComments(payload());
    }
    expect(sends()).toHaveLength(0);
  });
  it("short circuits replay before any Meta requests", async () => {
    receipt = { message_hash: "stored" };
    await ingestWebsiteComments(payload());
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not send for a different test sender, paused settings or missing scope", async () => {
    await ingestWebsiteComments(payload(event({ from: { id: "21", username: "someone" } })));
    cfg.mode = "off";
    await ingestWebsiteComments(payload());
    cfg.mode = "test";
    dm.mode = "off";
    await ingestWebsiteComments(payload());
    dm.mode = "live";
    conn.granted_scopes = [DM_SCOPE];
    await ingestWebsiteComments(payload());
    expect(fetch).not.toHaveBeenCalled();
  });
  it("acknowledges an already removed comment without sending", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ error: { code: 100 } }, { status: 400 }),
    );
    await ingestWebsiteComments(payload());
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("fails closed on storage failure and never retries ambiguous sends", async () => {
    dbError = { message: "unavailable" };
    await expect(ingestWebsiteComments(payload())).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    dbError = null;
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json(verified()))
      .mockResolvedValueOnce(Response.json(media()))
      .mockRejectedValueOnce(new Error("timeout"));
    await ingestWebsiteComments(payload());
    expect(sends()).toHaveLength(1);
  });
  it("requires the shared webhook signature before comment reads or sends", async () => {
    const raw = JSON.stringify(payload());
    const req = (signature: string) =>
      new Request("https://example.test/webhook", {
        method: "POST",
        body: raw,
        headers: { "x-hub-signature-256": signature },
      });
    expect((await dmWebhook(req("sha256=" + "0".repeat(64)))).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
    const good = "sha256=" + createHmac("sha256", "test-secret").update(raw).digest("hex");
    expect((await dmWebhook(req(good))).status).toBe(200);
    expect(sends()).toHaveLength(1);
  });
});

describe("comment setup", () => {
  it("retains existing webhook fields and reads back comments before enabling", async () => {
    const settings = query(cfg);
    settings.upsert = vi.fn(() => settings);
    mock.from.mockImplementation((table) =>
      table === "ig_comment_redirect_settings"
        ? settings
        : query(
            table === "user_roles"
              ? [{ role: "owner" }]
              : table === "ig_connections"
                ? c()
                : table === "ig_dm_redirect_settings"
                  ? dm
                  : [],
          ),
    );
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ user_id: KIIKII_ID, username: "kiikii.bat" }))
      .mockResolvedValueOnce(
        Response.json({ data: [{ subscribed_fields: ["messages", "messaging_seen"] }] }),
      )
      .mockResolvedValueOnce(Response.json({ success: true }))
      .mockResolvedValueOnce(
        Response.json({
          data: [{ subscribed_fields: ["messages", "messaging_seen", "comments"] }],
        }),
      );
    const result = await commentOperator("owner", "enable_test");
    expect(result.ready).toBe(true);
    expect(settings.upsert).toHaveBeenCalledWith(expect.objectContaining({ mode: "test" }), {
      onConflict: "user_id",
    });
    const fields = new URLSearchParams(
      vi.mocked(fetch).mock.calls[2][1]!.body as URLSearchParams,
    ).get("subscribed_fields");
    expect(fields?.split(",")).toEqual(
      expect.arrayContaining(["messages", "comments", "messaging_seen"]),
    );
  });
  it("refuses live mode without a private comment reply test", async () => {
    mock.from.mockImplementation((table) =>
      query(
        table === "user_roles"
          ? [{ role: "owner" }]
          : table === "ig_connections"
            ? c()
            : table === "ig_dm_redirect_settings"
              ? dm
              : [],
      ),
    );
    await expect(commentOperator("owner", "enable_live")).rejects.toThrow(
      "Test a new heart comment",
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it("refuses non-operators before any connection read", async () => {
    mock.from.mockReturnValue(query([{ role: "member" }]));
    await expect(commentOperator("someone", "status")).rejects.toThrow("Not authorized");
    expect(mock.from).toHaveBeenCalledTimes(1);
  });
});
