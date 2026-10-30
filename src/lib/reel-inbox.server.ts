import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { inboxAction, parseReelLinks, workerAction } from "./reel-inbox";
import type { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { reelProviderConfigured, ReelSourceError, resolveReelSource } from "./reel-source.server";

// Only this server module can call the service-role-only transaction function.
async function rpc(
  action: string,
  user: string | null,
  payload: unknown,
  hash: string | null = null,
) {
  const { data, error } = await (supabaseAdmin as SupabaseClient).rpc("reel_inbox_command", {
    p_action: action,
    p_user: user,
    p_payload: payload,
    p_device_hash: hash,
  });
  if (error)
    throw new Error(
      "Reel Inbox konnte den Auftrag nicht bestätigen. Bitte Einrichtung und Status prüfen.",
    );
  return data;
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function operatorCommand(user: string, action: z.infer<typeof inboxAction>) {
  if (action.action === "pair") {
    const token = [...crypto.getRandomValues(new Uint8Array(32))]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    await rpc("pair", user, { hash: await sha256(token) });
    return { token };
  }
  if (action.action === "submit") {
    const parsed = parseReelLinks(action.text);
    const results = await rpc("submit", user, {
      links: parsed.filter((i) => i.url),
      test: action.test,
    });
    return { results, invalid: parsed.filter((i) => i.error).map((i) => i.input) };
  }
  return rpc(action.action, user, action);
}
export async function workerRequest(request: Request) {
  const headers = { "Cache-Control": "no-store", "Content-Type": "application/json" };
  if (Number(request.headers.get("content-length") || 0) > 200000)
    return new Response("{}", { status: 413, headers });
  const token = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get("authorization") || "")?.[1];
  if (!token) return new Response("{}", { status: 401, headers });
  try {
    const reader = request.body?.getReader();
    if (!reader) return new Response("{}", { status: 400, headers });
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 200000) {
        await reader.cancel();
        return new Response("{}", { status: 413, headers });
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const parsed = workerAction.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
    if (!parsed.success) return new Response("{}", { status: 400, headers });
    const hash = await sha256(token);
    let result: unknown;
    if (parsed.data.action === "resolve") {
      // Authenticate the device and owned live lease before any provider/config access.
      await rpc("renew", null, parsed.data, hash);
      if (!reelProviderConfigured()) {
        return new Response(JSON.stringify({ error: "setup" }), { headers });
      }
      const db = supabaseAdmin as SupabaseClient;
      const reserved = await db.rpc("reel_inbox_resolve_source", {
        p_id: parsed.data.id,
        p_lease: parsed.data.lease,
        p_device_hash: hash,
      });
      if (reserved.error) throw new Error("Source reservation failed");
      if (!reserved.data) result = { error: "unavailable" };
      else if (reserved.data.error) result = { error: "setup" };
      else {
        const source = reserved.data as {
          canonical_url: string;
          shortcode: string;
          run_id: string;
        };
        try {
          result = await resolveReelSource(source.canonical_url, source.shortcode);
        } catch (error) {
          result = { error: error instanceof ReelSourceError ? error.code : "interrupted" };
        }
        const code = (result as { error?: string }).error;
        await db
          .from("scanner_runs")
          .update({
            status: code ? "failed" : "completed",
            error: code ?? null,
            completed_at: new Date().toISOString(),
            phase_detail: code
              ? `Reel download fallback: ${code}`
              : "Reel download source resolved",
          })
          .eq("id", source.run_id);
      }
    } else {
      result = await rpc(parsed.data.action, null, parsed.data, hash);
    }
    return new Response(JSON.stringify(result), { headers });
  } catch {
    return new Response(
      JSON.stringify({ error: "Auftrag nicht bestätigt; Verbindung oder Kopplung prüfen." }),
      { status: 503, headers },
    );
  }
}
