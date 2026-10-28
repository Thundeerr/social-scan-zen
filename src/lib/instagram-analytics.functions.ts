import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
export const instagramAnalyticsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ action: z.enum(["status", "sync"]) }).strict())
  .handler(async ({ data, context }) => {
    const { data: auth, error } = await context.supabase.auth.getUser();
    if (error || auth.user?.id !== context.userId || auth.user.is_anonymous)
      throw new Error("Bitte erneut anmelden.");
    const api = await import("./instagram-analytics.server");
    const result =
      data.action === "sync" ? await api.syncInstagramAnalytics(context.userId, true) : null;
    return {
      status: await api.instagramAnalyticsStatus(context.userId),
      skipped: result?.skipped === true,
    };
  });
