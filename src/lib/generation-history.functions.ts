import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const generationHistoryFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.auth.getUser();
    if (error || data.user?.id !== context.userId || data.user.is_anonymous)
      throw Error("Bitte erneut anmelden.");
    return (await import("./generation-history.server")).generationHistory(context.userId);
  });
