import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { ModelPublishAction, ModelPublishStatus } from "./model-publishing";
import { MAX_REVIEW_BYTES, type ReviewItem } from "./content-review";
const db = () => supabaseAdmin as SupabaseClient;
async function command(user: string, action: string, data: unknown) {
  const r = await db().rpc("model_publish_command", {
    p_user: user,
    p_action: action,
    p_data: data,
  });
  if (r.error)
    throw new Error("Veröffentlichung nicht möglich. Freigabe, Konto und Publishing-Pause prüfen.");
  return r.data;
}
export async function modelPublishing(
  user: string,
  action: ModelPublishAction,
): Promise<ModelPublishStatus> {
  if (action.action === "queue" || action.action === "schedule_preview")
    return command(user, action.action, action);
  const status = (await command(user, "status", action)) as ModelPublishStatus;
  if (action.action === "status") return status;
  if (action.action === "prepare" && !status.post_id) {
    if (!status.connected) throw new Error("Zuerst dieses Model mit Instagram verbinden.");
    const r = await db().rpc("content_review_command", {
      p_user: user,
      p_action: "get",
      p_payload: action,
    });
    const item = r.data as ReviewItem;
    if (
      r.error ||
      !item ||
      item.status !== "approved" ||
      item.revision !== action.revision ||
      !item.sha256
    )
      throw new Error("Video und aktuelle Caption zuerst freigeben.");
    const source = await db().storage.from("content-review").download(item.media_path);
    if (
      source.error ||
      !source.data ||
      source.data.size !== item.bytes ||
      source.data.size > MAX_REVIEW_BYTES
    )
      throw new Error("Quelldatei konnte nicht geprüft werden.");
    const bytes = Buffer.from(await source.data.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== item.sha256)
      throw new Error("Quelldatei hat sich geändert.");
    const path = `${user}/model-review/${item.id}/${item.sha256}.mp4`;
    const target = db().storage.from("ig-publish");
    const upload = await target.upload(path, bytes, { contentType: "video/mp4", upsert: false });
    if (upload.error) {
      // Lost success response or concurrent prepare: accept only the identical copy.
      const existing = await target.download(path);
      if (
        existing.error ||
        !existing.data ||
        createHash("sha256")
          .update(Buffer.from(await existing.data.arrayBuffer()))
          .digest("hex") !== item.sha256
      )
        throw new Error("Videokopie nicht bestätigt. Bitte erneut versuchen.");
    }
    await command(user, "prepare", { ...action, storage_path: path, sha256: item.sha256 });
  } else if (action.action !== "prepare") await command(user, action.action, action);
  return command(user, "status", action);
}
