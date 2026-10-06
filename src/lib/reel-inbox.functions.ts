import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { inboxAction } from "./reel-inbox";

export const reelInboxFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(inboxAction)
  .handler(async ({ data, context }) => {
    // Verify a live user, not merely a locally valid expired/revoked account JWT.
    const { data: auth, error } = await context.supabase.auth.getUser();
    if (error || auth.user?.id !== context.userId || auth.user.is_anonymous)
      throw new Error("Bitte erneut anmelden.");
    const { operatorCommand } = await import("./reel-inbox.server");
    return operatorCommand(context.userId, data);
  });
