import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { IG_API_BASE_URL } from "./instagram-oauth";
import {
  DM_LINK,
  DM_REPLIES,
  DM_SCOPE,
  KIIKII_ID,
  RESPONSE_WINDOW_MS,
  websiteDmEvents,
} from "./kiikii-dm-redirect";

const db = supabaseAdmin as SupabaseClient;
function checked<T>(result: { data: T; error: unknown }): T {
  if (result.error)
    throw new Error("Could not confirm the DM operation. Reload to check its status.");
  return result.data;
}
type Connection = {
  ig_user_id: string;
  ig_username: string;
  page_access_token: string;
  granted_scopes: string[];
  token_expires_at: string;
  status: string;
};
async function connection(user: string): Promise<Connection | null> {
  return checked(
    await db
      .from("ig_connections")
      .select("ig_user_id,ig_username,page_access_token,granted_scopes,token_expires_at,status")
      .eq("user_id", user)
      .eq("destination", "kiikii")
      .maybeSingle(),
  );
}
export function redirectConnectionReady(c: Connection | null): c is Connection {
  return Boolean(
    c &&
    c.ig_user_id === KIIKII_ID &&
    c.ig_username?.toLowerCase() === "kiikii.bat" &&
    c.status === "active" &&
    c.page_access_token &&
    c.granted_scopes?.includes(DM_SCOPE) &&
    Date.parse(c.token_expires_at) > Date.now() + 60_000,
  );
}
async function graph(path: string, token: string, body?: URLSearchParams) {
  const response = await fetch(`${IG_API_BASE_URL}/${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}` },
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok)
    throw new Error(
      "Meta could not confirm messaging access. Check the connection and app permissions.",
    );
  return response.json();
}

export async function redirectOperator(
  user: string,
  action: "status" | "enable_test" | "enable_live" | "pause",
) {
  const roles = checked(await db.from("user_roles").select("role").eq("user_id", user));
  if (!roles?.some((r) => r.role === "owner" || r.role === "cofounder"))
    throw new Error("Not authorized");
  const c = await connection(user);
  const configured = Boolean(
    process.env.INSTAGRAM_WEBHOOK_APP_SECRET || process.env.INSTAGRAM_APP_SECRET,
  );
  if (action === "pause")
    checked(await db.from("ig_dm_redirect_settings").update({ mode: "off" }).eq("user_id", user));
  if (action === "enable_test" || action === "enable_live") {
    if (!redirectConnectionReady(c) || !configured)
      throw new Error("Connect @kiikii.bat with messaging permission first.");
    if (action === "enable_live") {
      const accepted = checked(
        await db
          .from("ig_dm_redirect_receipts")
          .select("message_hash")
          .eq("user_id", user)
          .eq("status", "sent")
          .limit(1),
      );
      if (!accepted?.length)
        throw new Error("Send a fresh DM from user_diary01 and verify the test reply first.");
    }
    const profile = await graph("me?fields=user_id,username", c.page_access_token);
    if (
      String(profile.user_id ?? profile.id) !== KIIKII_ID ||
      profile.username?.toLowerCase() !== "kiikii.bat"
    )
      throw new Error("Meta returned a different account. No responder was enabled.");
    const current = await graph(`${KIIKII_ID}/subscribed_apps`, c.page_access_token);
    if (
      !Array.isArray(current.data) ||
      current.data.length > 1 ||
      current.data.some((s: { subscribed_fields?: unknown }) => !Array.isArray(s.subscribed_fields))
    )
      throw new Error("Existing Meta subscriptions need review before enabling.");
    const fields = new Set<string>(["messages"]);
    for (const sub of current.data)
      for (const field of sub.subscribed_fields) if (typeof field === "string") fields.add(field);
    const result = await graph(
      `${KIIKII_ID}/subscribed_apps`,
      c.page_access_token,
      new URLSearchParams({ subscribed_fields: [...fields].join(",") }),
    );
    if (result.success !== true) throw new Error("Meta did not confirm the messages subscription.");
    const readback = await graph(`${KIIKII_ID}/subscribed_apps`, c.page_access_token);
    if (
      !readback.data?.some((s: { subscribed_fields?: string[] }) =>
        s.subscribed_fields?.includes("messages"),
      )
    )
      throw new Error("Messages subscription could not be read back.");
    checked(
      await db
        .from("ig_dm_redirect_settings")
        .upsert(
          {
            user_id: user,
            receiver_id: KIIKII_ID,
            mode: action === "enable_test" ? "test" : "live",
            test_username: "user_diary01",
            activated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        ),
    );
  }
  const settings = checked(
    await db
      .from("ig_dm_redirect_settings")
      .select("mode,test_username,last_received_at")
      .eq("user_id", user)
      .maybeSingle(),
  );
  const receipts = checked(
    await db
      .from("ig_dm_redirect_receipts")
      .select("received_at,status,variant,error_code,finished_at")
      .eq("user_id", user)
      .order("received_at", { ascending: false })
      .limit(20),
  );
  return {
    ready: redirectConnectionReady(c) && configured,
    mode: settings?.mode ?? "off",
    testUsername: settings?.test_username ?? "user_diary01",
    lastReceived: settings?.last_received_at ?? null,
    link: DM_LINK,
    variantCount: DM_REPLIES.length,
    receipts: receipts ?? [],
  };
}

/** Exactly one HTTP attempt after a durable reservation; never replay an ambiguous send. */
export async function deliverWebsiteReply(token: string, sender: string, text: string) {
  try {
    const response = await fetch(`${IG_API_BASE_URL}/${KIIKII_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: { id: sender }, message: { text } }),
      redirect: "manual",
      signal: AbortSignal.timeout(7000),
    });
    const result = await response.json().catch(() => null);
    if (response.ok && typeof result?.message_id === "string")
      return {
        status: "sent",
        provider_message_id: result.message_id.slice(0, 2000),
        error_code: null,
      };
    const code = Number.isInteger(result?.error?.code)
      ? `meta_${result.error.code}`
      : `http_${response.status}`;
    return {
      status: response.status >= 400 && response.status < 500 ? "failed" : "uncertain",
      provider_message_id: null,
      error_code: code,
    };
  } catch {
    return { status: "uncertain", provider_message_id: null, error_code: "network_result_unknown" };
  }
}

export async function ingestWebsiteDm(body: unknown) {
  const events = websiteDmEvents(body);
  if (!events.length) return;
  const cfg = checked(
    await db
      .from("ig_dm_redirect_settings")
      .select("user_id,mode,test_username")
      .eq("receiver_id", KIIKII_ID)
      .maybeSingle(),
  );
  if (!cfg || cfg.mode === "off") return;
  const c = await connection(cfg.user_id);
  if (!redirectConnectionReady(c)) return;
  for (const event of events) {
    let username: string | null = null;
    if (cfg.mode === "test") {
      const profile = await graph(`${event.sender}?fields=username`, c.page_access_token);
      username = typeof profile.username === "string" ? profile.username.toLowerCase() : null;
      if (username !== cfg.test_username) continue;
    }
    const hash = createHash("sha256").update(event.mid).digest("hex");
    const reservation = checked(
      await db.rpc("ig_dm_redirect_reserve", {
        p_receiver: KIIKII_ID,
        p_sender: event.sender,
        p_hash: hash,
        p_event_at: new Date(event.timestamp).toISOString(),
        p_stop: event.stop,
        p_username: username,
      }),
    );
    if (!reservation?.send) continue;
    const text = DM_REPLIES[reservation.variant];
    const result =
      !text || event.timestamp < Date.now() - RESPONSE_WINDOW_MS
        ? { status: "failed", provider_message_id: null, error_code: "invalid_or_expired_event" }
        : await deliverWebsiteReply(c.page_access_token, event.sender, text);
    checked(
      await db
        .from("ig_dm_redirect_receipts")
        .update({ ...result, finished_at: new Date().toISOString() })
        .eq("user_id", cfg.user_id)
        .eq("message_hash", hash)
        .eq("status", "reserved"),
    );
  }
}
