import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const prepareAssetDownloadFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ assetId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: isOperator, error: roleError } = await supabase.rpc("is_operator", {
      _user_id: userId,
    });
    if (roleError) throw new Error(roleError.message);
    if (!isOperator) throw new Error("Forbidden");

    const { data: asset, error } = await supabase
      .from("assets")
      .select(
        "id, external_id, media_type, media_url, thumbnail_url, source_url, tracked_accounts(username)",
      )
      .eq("id", data.assetId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!asset) throw new Error("Asset not found");

    const { prepareAssetDownload } = await import("./download-media.server");
    return prepareAssetDownload({ asset, userId });
  });