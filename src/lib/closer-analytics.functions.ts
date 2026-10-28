import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
export const closerAnalyticsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.discriminatedUnion("action", [
      z
        .object({ action: z.literal("configure"), token: z.string().trim().min(16).max(4096) })
        .strict(),
      z.object({ action: z.enum(["status", "sync"]) }).strict(),
    ]),
  )
  .handler(async ({ data, context }) => {
    const { data: auth, error } = await context.supabase.auth.getUser();
    if (error || auth.user?.id !== context.userId || auth.user.is_anonymous)
      throw new Error("Bitte erneut anmelden.");
    const api = await import("./closer-analytics.server");
    if (data.action === "configure") await api.configureCloser(context.userId, data.token);
    const r =
      data.action === "sync" || data.action === "configure"
        ? await api.syncCloser(context.userId, true)
        : null;
    return { status: await api.closerStatus(context.userId), skipped: r?.skipped === true };
  });
