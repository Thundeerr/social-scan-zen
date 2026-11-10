import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const kiikiiCommentCampaignFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ action: z.enum(["status", "enable", "pause", "check", "catchup"]) }))
  .handler(async ({ context, data }) => {
    const { data: auth, error } = await context.supabase.auth.getUser();
    if (error || auth.user?.id !== context.userId || auth.user.is_anonymous) throw new Error("Please sign in again.");
    const { campaignOperator } = await import("./kiikii-comment-campaigns.server");
    return campaignOperator(context.userId, data.action);
  });
