import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { canonicalReel } from "./reel-inbox";
import { MAX_SOURCE_BYTES, type GenerationAction, type GenerationResult } from "./generation";
import { pipelineCommand } from "./model-pipeline.server";
const db = () => supabaseAdmin as SupabaseClient;
const bucket = () => db().storage.from("generation-sources");
async function command(user: string, action: string, data: unknown): Promise<GenerationResult> {
  const r = await db().rpc("generation_submit", { p_user: user, p_action: action, p_data: data });
  if (r.error || !r.data)
    throw Error(
      "Auftrag nicht bestätigt. Pipeline-Einrichtung prüfen; denselben Auftrag erneut bestätigen.",
    );
  return r.data;
}
export async function submitGeneration(
  user: string,
  action: GenerationAction,
): Promise<GenerationResult> {
  if (action.action === "check_link" || action.action === "check_file") {
    const source =
      action.action === "check_link"
        ? { kind: "link", ...canonicalReel(action.url) }
        : { kind: "file", sha256: action.sha256 };
    const r = await db().rpc("generation_source_check", { p_user: user, p_data: source });
    if (r.error || !r.data) throw Error("Duplikatprüfung fehlgeschlagen. Bitte erneut versuchen.");
    return r.data;
  }
  if (action.action === "link")
    return command(user, "link", {
      model: action.model,
      ...canonicalReel(action.url),
      duplicate_confirmed: action.duplicate_confirmed,
    });
  const upload = await command(user, "prepare", action);
  if (!upload.path) throw Error("Upload nicht gefunden.");
  if (action.action === "prepare") {
    const { data, error } = await bucket().createSignedUploadUrl(upload.path, { upsert: false });
    if (error || !data) throw Error("Upload konnte nicht vorbereitet werden.");
    return { id: upload.id, path: data.path, token: data.token };
  }
  const { data, error } = await bucket().download(upload.path);
  if (error || !data || data.size < 12 || data.size > MAX_SOURCE_BYTES)
    throw Error("MP4-Upload fehlt oder ist größer als 40 MB.");
  const bytes = Buffer.from(await data.arrayBuffer());
  if (bytes.toString("ascii", 4, 8) !== "ftyp") throw Error("Keine gültige MP4-Datei.");
  return command(user, "upload", {
    ...action,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}

// Private source delivery is authenticated by the existing worker token and job lease.
export async function generationSourceRequest(request: Request) {
  const token = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token) return new Response(null, { status: 401 });
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id"),
      lease = url.searchParams.get("lease");
    if (![id, lease].every((v) => v && /^[a-f0-9-]{36}$/.test(v))) throw Error("Invalid job");
    const job = await pipelineCommand(
      "get",
      null,
      { id, lease },
      createHash("sha256").update(token).digest("hex"),
    );
    if (
      !job?.source_upload_id ||
      job.state !== "working" ||
      new Date(job.lease_until).getTime() <= Date.now()
    )
      throw Error("No source");
    const { data: upload, error } = await db()
      .from("generation_uploads")
      .select("path")
      .eq("id", job.source_upload_id)
      .eq("user_id", job.user_id)
      .eq("model", job.model)
      .single();
    if (error || !upload) throw Error("No source");
    const result = await bucket().download(upload.path);
    if (result.error || !result.data || result.data.size > MAX_SOURCE_BYTES)
      throw Error("No source");
    return new Response(result.data, {
      headers: { "Content-Type": "video/mp4", "Cache-Control": "no-store" },
    });
  } catch {
    return new Response(null, { status: 403 });
  }
}
