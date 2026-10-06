import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { dmEvents, DM_RECEIVER, DM_SENDERS, DM_WEBHOOK } from "./reel-inbox-dm";
import { IG_API_BASE_URL } from "./instagram-oauth";

const db = supabaseAdmin as SupabaseClient;
const scope = "instagram_business_manage_messages";
const secret = () => process.env.INSTAGRAM_WEBHOOK_APP_SECRET || process.env.INSTAGRAM_APP_SECRET;
export function verifyToken(key: string) {
  return createHmac("sha256", key).update("reel-inbox-dm-webhook-v1").digest("hex");
}
function equal(a: string, b: string) {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function validSignature(bytes: Uint8Array, signature: string, key: string) {
  return equal(signature, "sha256=" + createHmac("sha256", key).update(bytes).digest("hex"));
}
function checked<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw new Error("DM-Verbindung konnte nicht bestätigt werden.");
  return result.data;
}
async function connection(user: string) {
  return checked(
    await db
      .from("ig_connections")
      .select("ig_user_id,ig_username,page_access_token,status,granted_scopes,token_expires_at")
      .eq("user_id", user)
      .maybeSingle(),
  );
}
function usable(
  c: Awaited<ReturnType<typeof connection>>,
): c is NonNullable<Awaited<ReturnType<typeof connection>>> {
  return Boolean(
    c &&
    c.ig_username?.toLowerCase() === DM_RECEIVER &&
    c.status === "active" &&
    c.granted_scopes?.includes(scope) &&
    Date.parse(c.token_expires_at) > Date.now(),
  );
}
async function graph(path: string, token: string, fields?: string, body?: URLSearchParams) {
  const url = new URL(`${IG_API_BASE_URL}/${path}`);
  if (fields) url.searchParams.set("fields", fields);
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}` },
    body,
    // Edge runtime supports manual redirects; non-2xx responses are rejected below.
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Meta-Verbindung prüfen; bitte erneut versuchen.");
  return response.json();
}
export async function dmOperator(user: string, action: "status" | "enable" | "disable" | "setup") {
  const roles = checked(await db.from("user_roles").select("role").eq("user_id", user));
  if (!roles?.some((r) => r.role === "owner" || r.role === "cofounder"))
    throw new Error("Nicht freigegeben.");
  if (action === "disable")
    checked(await db.from("reel_inbox_dm_sources").update({ enabled: false }).eq("user_id", user));
  const c = await connection(user);
  if (action === "enable") {
    if (!usable(c) || !secret())
      throw new Error(
        "@followerstarteam benötigt eine gültige Verbindung mit Nachrichten-Berechtigung.",
      );
    // The token must still identify the exact requested receiver, not another publisher.
    const profile = await graph("me", c.page_access_token, "user_id,username");
    if (
      profile.username?.toLowerCase() !== DM_RECEIVER ||
      String(profile.user_id ?? profile.id) !== String(c.ig_user_id)
    )
      throw new Error("Falscher Empfangsaccount.");
    const subscriptions = await graph(`${c.ig_user_id}/subscribed_apps`, c.page_access_token);
    if (
      !Array.isArray(subscriptions.data) ||
      subscriptions.data.length > 1 ||
      subscriptions.data.some(
        (s: { subscribed_fields?: unknown }) => !Array.isArray(s.subscribed_fields),
      )
    )
      throw new Error("Bestehende Meta-Abonnements bitte zuerst prüfen.");
    const fields = new Set<string>(["messages"]);
    for (const subscription of subscriptions.data)
      for (const field of subscription.subscribed_fields ?? [])
        if (typeof field === "string") fields.add(field);
    const sub = await graph(
      `${c.ig_user_id}/subscribed_apps`,
      c.page_access_token,
      undefined,
      new URLSearchParams({ subscribed_fields: [...fields].join(",") }),
    );
    if (sub.success !== true) throw new Error("Meta hat den Nachrichten-Empfang nicht bestätigt.");
    checked(
      await db
        .from("reel_inbox_dm_sources")
        .upsert(
          { user_id: user, receiver_id: String(c.ig_user_id), enabled: true },
          { onConflict: "user_id" },
        ),
    );
  }
  if (action === "setup") {
    const key = secret();
    if (!key) throw new Error("Meta-App-Geheimnis fehlt in der Serverkonfiguration.");
    return { webhook: DM_WEBHOOK, verifyToken: verifyToken(key) };
  }
  const source = checked(
    await db
      .from("reel_inbox_dm_sources")
      .select("enabled,last_received_at")
      .eq("user_id", user)
      .maybeSingle(),
  );
  const receipts = checked(
    await db
      .from("reel_inbox_dm_receipts")
      .select("sender,status,link_count,received_at")
      .eq("user_id", user)
      .order("received_at", { ascending: false })
      .limit(10),
  );
  const senders = checked(
    await db.from("reel_inbox_dm_senders").select("username").eq("user_id", user),
  );
  return {
    readyToConnect: Boolean(usable(c) && secret()),
    enabled: Boolean(source?.enabled),
    lastReceived: source?.last_received_at ?? null,
    expiresAt: c?.token_expires_at ?? null,
    senders: senders?.map((s) => s.username) ?? [],
    receipts: receipts ?? [],
  };
}

export async function ingestDm(body: unknown) {
  for (const event of dmEvents(body)) {
    const src = checked(
      await db
        .from("reel_inbox_dm_sources")
        .select("user_id")
        .eq("receiver_id", event.receiver)
        .eq("enabled", true)
        .maybeSingle(),
    );
    if (!src) continue;
    const c = await connection(src.user_id);
    if (!usable(c) || String(c.ig_user_id) !== event.receiver)
      throw new Error("Receiver connection unavailable");
    const allowed = checked(
      await db
        .from("reel_inbox_dm_senders")
        .select("sender_id,username")
        .eq("user_id", src.user_id),
    );
    let username = allowed?.find((s) => s.sender_id === event.sender)?.username;
    if (!username) {
      if (allowed?.length === DM_SENDERS.length) continue;
      // Resolve minimal identity through Meta, never trust message text/display names.
      const profile = await graph(event.sender, c.page_access_token, "username");
      username = typeof profile.username === "string" ? profile.username.toLowerCase() : "";
      if (!DM_SENDERS.some((name) => name === username)) continue;
    }
    checked(
      await db.rpc("reel_inbox_dm_ingest", {
        p_receiver: event.receiver,
        p_sender: event.sender,
        p_username: username,
        p_hash: createHash("sha256").update(event.mid).digest("hex"),
        p_links: event.links,
      }),
    );
  }
}
export async function dmWebhook(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const key = secret();
  if (!key) return new Response("Not configured", { status: 503, headers });
  if (request.method === "GET") {
    const q = new URL(request.url).searchParams;
    if (
      q.get("hub.mode") !== "subscribe" ||
      !equal(q.get("hub.verify_token") ?? "", verifyToken(key))
    )
      return new Response("Forbidden", { status: 403, headers });
    const challenge = q.get("hub.challenge") ?? "";
    if (!/^\d{1,100}$/.test(challenge))
      return new Response("Invalid challenge", { status: 400, headers });
    return new Response(challenge, { headers });
  }
  if (request.method !== "POST") return new Response(null, { status: 405, headers });
  if (!/^sha256=[a-f0-9]{64}$/.test(request.headers.get("x-hub-signature-256") ?? ""))
    return new Response("Forbidden", { status: 403, headers });
  const reader = request.body?.getReader();
  if (!reader) return new Response(null, { status: 400, headers });
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 262144) {
        await reader.cancel();
        return new Response(null, { status: 413, headers });
      }
      chunks.push(part.value);
    }
    const bytes = Buffer.concat(chunks);
    if (!validSignature(bytes, request.headers.get("x-hub-signature-256") ?? "", key))
      return new Response("Forbidden", { status: 403, headers });
    const body = JSON.parse(bytes.toString("utf8"));
    dmEvents(body); // malformed batches are rejected before any storage
    await ingestDm(body); // acknowledge only after durable transaction; Meta can retry
    return new Response("EVENT_RECEIVED", { headers });
  } catch {
    return new Response("Not confirmed; retry", { status: 503, headers });
  }
}
