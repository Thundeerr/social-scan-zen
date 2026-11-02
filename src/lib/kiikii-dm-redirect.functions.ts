import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const kiikiiDmRedirectFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ action: z.enum(["status", "enable_test", "enable_live", "pause"]) }))
  .handler(async ({ context, data }) => {
    const { data: auth, error } = await context.supabase.auth.getUser();
    if (error || auth.user?.id !== context.userId || auth.user.is_anonymous)
      throw new Error("Please sign in again.");
    const { redirectOperator } = await import("./kiikii-dm-redirect.server");
    return redirectOperator(context.userId, data.action);
  });
