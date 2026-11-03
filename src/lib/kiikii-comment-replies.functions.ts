import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const kiikiiCommentRepliesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ action: z.enum(["status", "enable_test", "enable_live", "pause"]) }))
  .handler(async ({ context, data }) => {
    const { data: auth, error } = await context.supabase.auth.getUser();
    if (error || auth.user?.id !== context.userId || auth.user.is_anonymous)
      throw new Error("Please sign in again.");
    const { commentOperator } = await import("./kiikii-comment-replies.server");
    return commentOperator(context.userId, data.action);
  });
