import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { dmEvents } from "./reel-inbox-dm";
const mock = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: mock }));
import { dmWebhook, ingestDm, verifyToken } from "./reel-inbox-dm.server";
const link = "https://www.instagram.com/reel/Chunk8-jurw/?tracking=ignored";
const event = (extra = {}) => ({
  sender: { id: "20" },
  recipient: { id: "10" },
  message: { mid: "test-message", text: link, ...extra },
});
const payload = (e = event()) => ({ object: "instagram", entry: [{ id: "10", messaging: [e] }] });
const request = (body: unknown, signature = true) => {
  const text = JSON.stringify(body);
  return new Request("https://instascanner.app/api/public/instagram/inbox-webhook", {
    method: "POST",
    body: text,
    headers: {
      "x-hub-signature-256": signature
        ? "sha256=" + createHmac("sha256", "test-secret").update(text).digest("hex")
        : "sha256=" + "0".repeat(64),
    },
  });
};
function query(data: unknown) {
  const q = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
    then: (ok: (r: unknown) => unknown) => Promise.resolve({ data, error: null }).then(ok),
  };
  q.select.mockReturnValue(q);
  q.eq.mockReturnValue(q);
  q.maybeSingle.mockResolvedValue({ data, error: null });
  return q;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("INSTAGRAM_WEBHOOK_APP_SECRET", "test-secret");
  vi.stubGlobal("fetch", vi.fn());
  mock.rpc.mockResolvedValue({ data: { ok: true }, error: null });
});
describe("DM parsing", () => {
  it.each(["share", "ig_reel", "reel", "ig_post", "post"])(
    "extracts a permalink from a %s card without text",
    (type) => {
      const parsed = dmEvents(
        payload(
          event({
            text: undefined,
            attachments: [
              {
                type,
                payload: {
                  url: "https://lookaside.fbsbx.com/temporary?secret=hidden",
                  permalink: "https://www.instagram.com/kiikii.bat/reel/Chunk8-jurw/",
                },
              },
            ],
          }),
        ),
      )[0];
      expect(parsed.links).toEqual([
        { shortcode: "Chunk8-jurw", url: "https://www.instagram.com/reel/Chunk8-jurw/" },
      ]);
      expect(parsed.diagnostics.outcome).toBe("link_found");
      expect(JSON.stringify(parsed.diagnostics)).not.toContain("hidden");
    },
  );
  it("retains text links when an attachment has no usable payload", () => {
    for (const p of [null, undefined, "malformed", { url: 123 }]) {
      expect(
        dmEvents(payload(event({ attachments: [{ type: "ig_reel", payload: p }] })))[0].links,
      ).toHaveLength(1);
    }
  });
  it("diagnoses unsupported and CDN-only cards without inventing a permalink", () => {
    expect(
      dmEvents(payload(event({ text: undefined, is_unsupported: true })))[0].diagnostics.outcome,
    ).toBe("unsupported");
    const parsed = dmEvents(
      payload(
        event({
          text: undefined,
          attachments: [
            {
              type: "ig_reel",
              payload: { url: "https://lookaside.fbsbx.com/media?id=123", id: "123", title: link },
            },
          ],
        }),
      ),
    )[0];
    expect(parsed.links).toEqual([]);
    expect(parsed.diagnostics.outcome).toBe("no_permalink");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not mine arbitrary attachment fields for links", () => {
    expect(
      dmEvents(
        payload(
          event({
            text: undefined,
            attachments: [
              { type: "image", payload: { url: link } },
              { type: "share", payload: { title: link, nested: { url: link } } },
            ],
          }),
        ),
      )[0].links,
    ).toEqual([]);
  });
  it("canonicalizes text and shared posts with dedupe", () => {
    const p = payload(event({ attachments: [{ type: "share", payload: { url: link } }] }));
    expect(dmEvents(p)[0].links).toEqual([
      { shortcode: "Chunk8-jurw", url: "https://www.instagram.com/reel/Chunk8-jurw/" },
    ]);
  });
  it("never follows direct CDN, private hosts or profile URLs", () => {
    expect(
      dmEvents(
        payload(
          event({
            text: "https://127.0.0.1/reel/Chunk8-jurw/",
            attachments: [
              { type: "share", payload: { url: "https://cdninstagram.com/temporary.mp4" } },
            ],
          }),
        ),
      )[0].links,
    ).toEqual([]);
  });
  it("ignores echoes, deleted messages, recipient mismatch and missing messages", () => {
    for (const extra of [{ is_echo: true }, { is_deleted: true }])
      expect(dmEvents(payload(event(extra)))).toEqual([]);
    const e = event();
    e.recipient.id = "99";
    expect(dmEvents(payload(e))).toEqual([]);
    expect(
      dmEvents({ object: "instagram", entry: [{ id: "10", messaging: [{ read: {} }] }] }),
    ).toEqual([]);
  });
});
describe("DM authentication and durable intake", () => {
  it("verifies the challenge without database access", async () => {
    const url = `https://instascanner.app/api/public/instagram/inbox-webhook?hub.mode=subscribe&hub.challenge=123&hub.verify_token=${verifyToken("test-secret")}`;
    expect(await (await dmWebhook(new Request(url))).text()).toBe("123");
    expect((await dmWebhook(new Request(url + "x"))).status).toBe(403);
    expect(mock.from).not.toHaveBeenCalled();
  });
  it("rejects forged signatures and oversized streaming bodies before storage", async () => {
    expect((await dmWebhook(request(payload(), false))).status).toBe(403);
    expect((await dmWebhook(request("x".repeat(262145)))).status).toBe(413);
    expect(mock.from).not.toHaveBeenCalled();
  });
  it("ignores unrelated receivers", async () => {
    mock.from.mockReturnValue(query(null));
    expect((await dmWebhook(request(payload()))).status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  function account(senders: unknown[]) {
    mock.from.mockImplementation((table: string) =>
      query(
        table === "reel_inbox_dm_sources"
          ? { user_id: "owner" }
          : table === "ig_connections"
            ? {
                ig_username: "followerstarteam",
                ig_user_id: "10",
                status: "active",
                granted_scopes: ["instagram_business_manage_messages"],
                token_expires_at: "2099-01-01",
                page_access_token: "fixture-token",
              }
            : senders,
      ),
    );
  }
  it("requires Meta-verified username for initial sender binding", async () => {
    account([]);
    vi.mocked(fetch).mockResolvedValue(Response.json({ username: "kiikii.bat" }));
    await ingestDm(payload());
    expect(mock.rpc.mock.calls[0][1]).toMatchObject({
      p_sender: "20",
      p_username: "kiikii.bat",
      p_receiver: "10",
    });
    expect(mock.rpc.mock.calls[0][1].p_hash).toMatch(/^[a-f0-9]{64}$/);
  });
  it("ignores unapproved usernames without storing their message", async () => {
    account([]);
    vi.mocked(fetch).mockResolvedValue(Response.json({ username: "other" }));
    await ingestDm(payload());
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("uses pinned identities without profile lookups", async () => {
    account([{ sender_id: "20", username: "kiikii.bat" }]);
    expect((await dmWebhook(request(payload()))).status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
    expect(mock.rpc).toHaveBeenCalledOnce();
    expect(mock.rpc).toHaveBeenCalledWith(
      "reel_inbox_dm_ingest_v2",
      expect.objectContaining({
        p_diagnostics: expect.objectContaining({ outcome: "link_found" }),
      }),
    );
  });
  it("does not acknowledge failed persistence and exposes no secrets", async () => {
    account([{ sender_id: "20", username: "kiikii.bat" }]);
    mock.rpc.mockResolvedValue({ error: { message: "fixture-token" }, data: null });
    const r = await dmWebhook(request(payload()));
    expect(r.status).toBe(503);
    expect(await r.text()).not.toContain("fixture-token");
  });
});
