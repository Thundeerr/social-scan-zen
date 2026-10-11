import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { modelPublishAction } from "./model-publishing";
export const modelPublishingFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(modelPublishAction)
  .handler(async ({ data, context }) => {
    const auth = await context.supabase.auth.getUser();
    if (auth.error || auth.data.user?.id !== context.userId || auth.data.user.is_anonymous)
      throw new Error("Bitte erneut anmelden.");
    const { modelPublishing } = await import("./model-publishing.server");
    return modelPublishing(context.userId, data);
  });
