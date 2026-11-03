import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const reelInboxDmFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.union([
      z.object({ action: z.enum(["status", "enable", "disable", "setup"]) }),
      z.object({
        action: z.literal("reassign"),
        inboxId: z.string().uuid(),
        fromModel: z.enum(["kiikii", "tuuva"]),
        toModel: z.enum(["kiikii", "tuuva"]),
      }),
    ]),
  )
  .handler(async ({ context, data }) => {
    const { data: auth, error } = await context.supabase.auth.getUser();
    if (error || auth.user?.id !== context.userId || auth.user.is_anonymous)
      throw new Error("Bitte erneut anmelden.");
    const { dmOperator, reassignDm } = await import("./reel-inbox-dm.server");
    if (data.action === "reassign")
      return reassignDm(context.userId, data.inboxId, data.fromModel, data.toModel);
    return dmOperator(context.userId, data.action);
  });
