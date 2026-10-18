import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const catalogueImportFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({
    videos: z.string().max(1000000),
    offers: z.string().max(1000000),
    preview: z.boolean().default(true),
  }).strict())
  .handler(async ({ data, context }) => {
    const { data: auth, error } = await context.supabase.auth.getUser();
    if (error || auth.user?.id !== context.userId || auth.user.is_anonymous)
      throw new Error("Bitte erneut anmelden.");
    const { importDesktopCatalogue } = await import("./catalogue-import.server");
    return importDesktopCatalogue(context.userId, data);
  });
