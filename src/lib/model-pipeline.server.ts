import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { reviewCommand } from "./content-review.server";
import type { ReviewItem } from "./content-review";
const db = () => supabaseAdmin as SupabaseClient;
export async function pipelineCommand(
  action: string,
  user: string | null,
  data: unknown = {},
  hash: string | null = null,
) {
  const r = await db().rpc("model_pipeline_command", {
    p_action: action,
    p_user: user,
    p_data: data,
    p_worker_hash: hash,
  });
  if (r.error) throw new Error("Pipeline-Aktion nicht bestätigt.");
  return r.data;
}
export async function pipelineOperator(
  user: string,
  action: "status" | "pair" | "pause" | "enable",
) {
  if (action === "pair") {
    const token = randomBytes(32).toString("hex");
    await pipelineCommand("pair", user, { hash: createHash("sha256").update(token).digest("hex") });
    return { token };
  }
  return pipelineCommand(action, user);
}
const ref = { id: z.string().uuid(), lease: z.string().uuid() };
const worker = z.discriminatedUnion("action", [
  z.object({ action: z.literal("claim") }),
  z.object({ action: z.literal("get"), ...ref }),
  z.object({ action: z.literal("reserve"), ...ref, seconds: z.number().min(2).max(15) }),
  z.object({
    action: z.literal("submitted"),
    ...ref,
    provider_id: z.string().regex(/^[a-f0-9]{32}$/),
  }),
  z.object({
    action: z.literal("block"),
    ...ref,
    issue: z.enum([
      "source_unavailable",
      "duration",
      "validation",
      "provider_uncertain",
      "provider_failed",
      "setup",
    ]),
  }),
  z.object({ action: z.literal("review"), ...ref, caption: z.string().max(2200) }),
  z.object({ action: z.literal("finish"), ...ref }),
]);
export async function pipelineWorkerRequest(request: Request) {
  const headers = { "Cache-Control": "no-store", "Content-Type": "application/json" };
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { headers, status });
  const token = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token) return reply({}, 401);
  try {
    const reader = request.body?.getReader();
    if (!reader) return reply({}, 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 16000) {
        await reader.cancel();
        return reply({}, 413);
      }
      chunks.push(part.value);
    }
    const parsed = worker.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (!parsed.success) return reply({}, 400);
    const data = parsed.data,
      hash = createHash("sha256").update(token).digest("hex");
    const job = await pipelineCommand(
      data.action === "finish" ? "get" : data.action,
      null,
      data,
      hash,
    );
    if (!job) return reply(null);
    if (data.action === "review" || data.action === "finish") {
      if (!job.review_id || !["generating", "review"].includes(job.state)) throw Error("Not ready");
      const r = await db().rpc("content_review_command", {
        p_user: job.user_id,
        p_action: "get",
        p_payload: { id: job.review_id },
      });
      if (r.error) throw Error("Review missing");
      let item = r.data as ReviewItem;
      if (data.action === "review") {
        if (item.status !== "uploading") return reply({ uploaded: true, review_id: item.id });
        const upload = await db()
          .storage.from("content-review")
          .createSignedUploadUrl(item.media_path, { upsert: false });
        if (upload.error || !upload.data) throw Error("Upload unavailable");
        return reply({ review_id: item.id, upload_url: upload.data.signedUrl });
      }
      if (item.status === "uploading")
        item = (
          await reviewCommand(job.user_id, {
            action: "finalize",
            id: item.id,
            revision: item.revision,
          })
        ).item!;
      await pipelineCommand("review", null, data, hash);
      if (item.status === "pending" && item.notification === "none")
        await reviewCommand(job.user_id, {
          action: "notify",
          id: item.id,
          revision: item.revision,
        });
      return reply({ review_id: item.id, finished: true });
    }
    const { user_id: _owner, ...safe } = job;
    void _owner;
    return reply(safe);
  } catch {
    return reply(
      {
        error:
          "Nicht bestätigt. Status prüfen; kostenpflichtige Aufträge niemals blind wiederholen.",
      },
      409,
    );
  }
}
