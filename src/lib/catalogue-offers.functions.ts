import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { offerAction } from "./catalogue-offers";

export const catalogueOffersFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(offerAction)
  .handler(async ({ data, context }) => {
    const { data: auth, error } = await context.supabase.auth.getUser();
    if (error || auth.user?.id !== context.userId || auth.user.is_anonymous)
      throw new Error("Bitte erneut anmelden.");
    const { catalogueOfferCommand } = await import("./catalogue-offers.server");
    return catalogueOfferCommand(context.userId, data);
  });
