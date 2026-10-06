import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const reelInboxDmFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ action: z.enum(["status", "enable", "disable", "setup"]) }))
  .handler(async ({ context, data }) => {
    const { data: auth, error } = await context.supabase.auth.getUser();
    if (error || auth.user?.id !== context.userId || auth.user.is_anonymous)
      throw new Error("Bitte erneut anmelden.");
    const { dmOperator } = await import("./reel-inbox-dm.server");
    return dmOperator(context.userId, data.action);
  });
