import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  checked,
  connection,
  graph,
  commentGraph,
  deliverWebsiteReply,
  redirectConnectionReady,
} from "./kiikii-dm-redirect.server";
import { DM_LINK, DM_REPLIES, KIIKII_ID, RESPONSE_WINDOW_MS } from "./kiikii-dm-redirect";
import {
  COMMENT_SCOPE,
  commentTrigger,
  websiteCommentEvents,
  verifiedCommentSchema,
  verifiedMediaSchema,
} from "./kiikii-comment-replies";

const db = supabaseAdmin as SupabaseClient;
export async function commentOperator(
  user: string,
  action: "status" | "enable_test" | "enable_live" | "pause",
) {
  const roles = checked(await db.from("user_roles").select("role").eq("user_id", user));
  if (!roles?.some((r) => ["owner", "cofounder"].includes(r.role)))
    throw new Error("Not authorized");
  const c = await connection(user);
  const dm = checked(
    await db
      .from("ig_dm_redirect_settings")
      .select("mode,test_username")
      .eq("user_id", user)
      .maybeSingle(),
  );
  const ready =
    redirectConnectionReady(c) &&
    c.granted_scopes.includes(COMMENT_SCOPE) &&
    Boolean(process.env.INSTAGRAM_WEBHOOK_APP_SECRET || process.env.INSTAGRAM_APP_SECRET) &&
    dm?.mode !== "off" &&
    !!dm;
  if (action === "pause")
    checked(
      await db.from("ig_comment_redirect_settings").update({ mode: "off" }).eq("user_id", user),
    );
  if (action === "enable_test" || action === "enable_live") {
    if (!ready || !c)
      throw new Error("Enable Kiikii messaging and grant comment permission first.");
    if (action === "enable_live") {
      if (dm.mode !== "live") throw new Error("Enable the main DM responder for visitors first.");
      const accepted = checked(
        await db
          .from("ig_dm_redirect_receipts")
          .select("message_hash")
          .eq("user_id", user)
          .eq("source", "comment")
          .eq("status", "sent")
          .limit(1),
      );
      if (!accepted?.length)
        throw new Error(
          "Test a new heart comment from user_diary01 and verify the private reply first.",
        );
    }
    const profile = await graph("me?fields=user_id,username", c.page_access_token);
    if (
      String(profile.user_id ?? profile.id) !== KIIKII_ID ||
      profile.username?.toLowerCase() !== "kiikii.bat"
    )
      throw new Error("Meta returned a different Instagram account.");
    const current = await graph(`${KIIKII_ID}/subscribed_apps`, c.page_access_token);
    if (
      !Array.isArray(current.data) ||
      current.data.length > 1 ||
      current.data.some((s: { subscribed_fields?: unknown }) => !Array.isArray(s.subscribed_fields))
    )
      throw new Error("Existing Meta subscriptions need review.");
    const fields = new Set<string>(["comments", "messages"]);
    for (const sub of current.data)
      for (const f of sub.subscribed_fields) if (typeof f === "string") fields.add(f);
    const result = await graph(
      `${KIIKII_ID}/subscribed_apps`,
      c.page_access_token,
      new URLSearchParams({ subscribed_fields: [...fields].join(",") }),
    );
    if (result.success !== true) throw new Error("Meta did not confirm comment notifications.");
    const readback = await graph(`${KIIKII_ID}/subscribed_apps`, c.page_access_token);
    if (
      !readback.data?.some(
        (s: { subscribed_fields?: string[] }) =>
          s.subscribed_fields?.includes("comments") && s.subscribed_fields?.includes("messages"),
      )
    )
      throw new Error("Comment subscription could not be read back.");
    checked(
      await db.from("ig_comment_redirect_settings").upsert(
        {
          user_id: user,
          mode: action === "enable_test" ? "test" : "live",
          activated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      ),
    );
  }
  const settings = checked(
    await db
      .from("ig_comment_redirect_settings")
      .select("mode,last_received_at")
      .eq("user_id", user)
      .maybeSingle(),
  );
  const receipts = checked(
    await db
      .from("ig_dm_redirect_receipts")
      .select("received_at,status,error_code")
      .eq("user_id", user)
      .eq("source", "comment")
      .order("received_at", { ascending: false })
      .limit(10),
  );
  const accepted = checked(
    await db
      .from("ig_dm_redirect_receipts")
      .select("message_hash")
      .eq("user_id", user)
      .eq("source", "comment")
      .eq("status", "sent")
      .limit(1),
  );
  return {
    ready,
    mode: settings?.mode ?? "off",
    testUsername: dm?.test_username ?? "user_diary01",
    lastReceived: settings?.last_received_at ?? null,
    receipts: receipts ?? [],
    tested: !!accepted?.length,
    link: DM_LINK,
  };
}

/** Only called after verification of Meta's signature by the shared webhook. */
export async function ingestWebsiteComments(body: unknown) {
  const events = websiteCommentEvents(body);
  if (!events.length) return;
  const dm = checked(
    await db
      .from("ig_dm_redirect_settings")
      .select("user_id,mode,test_username")
      .eq("receiver_id", KIIKII_ID)
      .maybeSingle(),
  );
  if (!dm || dm.mode === "off") return;
  const cfg = checked(
    await db
      .from("ig_comment_redirect_settings")
      .select("mode,activated_at")
      .eq("user_id", dm.user_id)
      .maybeSingle(),
  );
  if (!cfg || cfg.mode === "off" || !cfg.activated_at) return;
  const c = await connection(dm.user_id);
  if (!redirectConnectionReady(c) || !c.granted_scopes.includes(COMMENT_SCOPE)) return;
  // Meta uses the Instagram-login scoped id for media.owner, while webhook
  // entry.id uses user_id. Verify both against this token, not a guessed ID.
  const ownIds = new Set([KIIKII_ID]);
  let profileChecked = false;
  const mediaCache = new Map<string, ReturnType<typeof verifiedMediaSchema.parse>>();
  for (const event of events) {
    if ((cfg.mode === "test" || dm.mode === "test") && event.username !== dm.test_username)
      continue;
    const hash = createHash("sha256").update(`comment:${event.comment}`).digest("hex");
    const existing = checked(
      await db
        .from("ig_dm_redirect_receipts")
        .select("message_hash")
        .eq("user_id", dm.user_id)
        .eq("message_hash", hash)
        .maybeSingle(),
    );
    if (existing) continue;
    // Re-read the actual creation time and text. Notification time alone cannot
    // distinguish a new comment from an old comment being edited/replayed.
    const comment = verifiedCommentSchema.safeParse(
      await commentGraph(
        `${event.comment}?fields=id,text,timestamp,from,media,parent_id,hidden`,
        c.page_access_token,
      ),
    );
    if (!comment.success) continue;
    const v = comment.data;
    const timestamp = Date.parse(v.timestamp);
    if (
      v.id !== event.comment ||
      (v.from.id !== undefined && v.from.id !== event.sender) ||
      v.from.username.toLowerCase() !== event.username ||
      v.media.id !== event.media ||
      v.parent_id ||
      v.hidden ||
      !Number.isFinite(timestamp) ||
      timestamp < Date.parse(cfg.activated_at) - 5000 ||
      timestamp < Date.now() - RESPONSE_WINDOW_MS ||
      timestamp > Date.now() + 300000
    )
      continue;
    if (
      (cfg.mode === "test" || dm.mode === "test") &&
      v.from.username.toLowerCase() !== dm.test_username
    )
      continue;
    let media = mediaCache.get(event.media);
    if (!media) {
      const parsed = verifiedMediaSchema.safeParse(
        await commentGraph(`${event.media}?fields=id,owner,caption,permalink`, c.page_access_token),
      );
      if (!parsed.success || parsed.data.id !== event.media) continue;
      if (!ownIds.has(parsed.data.owner.id) && !profileChecked) {
        const profile = await graph("me?fields=user_id,username", c.page_access_token);
        if (
          String(profile.user_id) !== KIIKII_ID ||
          profile.username?.toLowerCase() !== "kiikii.bat"
        )
          return;
        ownIds.add(String(profile.id));
        profileChecked = true;
      }
      if (!ownIds.has(parsed.data.owner.id)) continue;
      media = parsed.data;
      mediaCache.set(event.media, media);
    }
    if (!commentTrigger(v.text, media.caption)) continue;
    const reservation = checked(
      await db.rpc("ig_comment_redirect_reserve", {
        p_receiver: KIIKII_ID,
        p_sender: event.sender,
        p_hash: hash,
        p_event_at: new Date(timestamp).toISOString(),
        p_username: v.from.username.toLowerCase(),
        p_trigger: true,
      }),
    );
    if (!reservation?.send) continue;
    const text = DM_REPLIES[reservation.variant];
    const result =
      !text || timestamp < Date.now() - RESPONSE_WINDOW_MS
        ? { status: "failed", provider_message_id: null, error_code: "invalid_or_expired_event" }
        : await deliverWebsiteReply(c.page_access_token, event.comment, text, "comment");
    checked(
      await db
        .from("ig_dm_redirect_receipts")
        .update({ ...result, finished_at: new Date().toISOString() })
        .eq("user_id", dm.user_id)
        .eq("message_hash", hash)
        .eq("source", "comment")
        .eq("status", "reserved"),
    );
  }
}
