import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
export const fanvueAnalyticsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.discriminatedUnion("action", [
      z
        .object({
          action: z.literal("configure"),
          clientSecret: z.string().trim().min(16).max(4096),
        })
        .strict(),
      z.object({ action: z.enum(["status", "connect", "sync", "disconnect"]) }).strict(),
    ]),
  )
  .handler(async ({ data, context }) => {
    const { data: auth, error } = await context.supabase.auth.getUser();
    if (error || auth.user?.id !== context.userId || auth.user.is_anonymous)
      throw new Error("Bitte erneut anmelden.");
    const api = await import("./fanvue-analytics.server");
    if (context.userId !== api.FANVUE_OWNER)
      throw new Error("Nur für den Kiikii-Betreiber verfügbar.");
    if (data.action === "configure") await api.configureFanvue(context.userId, data.clientSecret);
    if (data.action === "sync") await api.syncFanvue(context.userId, true);
    if (data.action === "disconnect") await api.disconnectFanvue(context.userId);
    if (data.action === "connect") {
      const { setCookie } = await import("@tanstack/react-start/server");
      const flow = await api.beginFanvue(context.userId);
      setCookie("__Host-fanvue-state", flow.browser, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 600,
      });
      return { url: flow.url, status: await api.fanvueStatus(context.userId) };
    }
    return { url: null, status: await api.fanvueStatus(context.userId) };
  });
