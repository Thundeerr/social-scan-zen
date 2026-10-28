import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
export const waveAnalyticsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ action: z.enum(["status", "sync"]) }).strict())
  .handler(async ({ data, context }) => {
    const { data: auth, error } = await context.supabase.auth.getUser();
    if (error || auth.user?.id !== context.userId || auth.user.is_anonymous)
      throw Error("Bitte erneut anmelden.");
    const api = await import("./wavespeed-analytics.server");
    if (data.action === "sync") await api.requestWaveSync(context.userId);
    return api.waveStatus(context.userId);
  });
