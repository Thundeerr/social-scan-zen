/**
 * Scanner server functions.
 *
 * `scanAccountNowFn` — authenticated manual trigger from the UI.
 * `runQueueTickFn`   — authenticated "run one tick" for debugging.
 *
 * The autonomous scheduler runs via the public cron route at
 * /api/public/hooks/scanner-tick — see src/routes/api/public/hooks/scanner-tick.ts
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const scanAccountNowFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { accountId: string }) =>
    z.object({ accountId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { scanAccountNow } = await import("@/lib/scanner-service.server");
    return scanAccountNow(context.supabase, data.accountId);
  });

export const runQueueTickFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { tickQueue } = await import("@/lib/scanner-service.server");
    return tickQueue(context.supabase);
  });
