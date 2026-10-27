import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
export const businessReportFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ action: z.enum(["status", "send"]) }).strict())
  .handler(async ({ data, context }) => {
    const { data: auth, error } = await context.supabase.auth.getUser();
    if (error || auth.user?.id !== context.userId || auth.user.is_anonymous)
      throw new Error("Bitte erneut anmelden.");
    const api = await import("./business-report.server");
    const report = await api.businessReport(context.userId);
    if (data.action === "send") {
      const receipt = await api.sendBusinessReport(
        context.userId,
        `manual:${Math.floor(Date.now() / 60000)}`,
        report.text,
      );
      if (receipt.duplicate)
        throw new Error("In dieser Minute bereits angefordert. Bitte Telegram prüfen; es wurde kein zweiter Bericht gesendet.");
    }
    return report;
  });
