/**
 * Autonomous scanner tick — called by pg_cron every minute.
 *
 * The route is public so pg_cron can reach it without a user session, but it
 * authenticates the caller with a dedicated server-only CRON_SECRET (never
 * shipped to the client) via a constant-time comparison. All writes still go
 * through the service role so RLS's operator-only policies remain enforced
 * for regular users.
 */

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import type { Database } from "@/integrations/supabase/types";

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export const Route = createFileRoute("/api/public/hooks/scanner-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.CRON_SECRET;
        if (!expected) {
          return new Response(
            JSON.stringify({ error: "cron secret not configured" }),
            { status: 500, headers: { "content-type": "application/json" } },
          );
        }
        const provided =
          request.headers.get("x-cron-secret") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          "";
        if (!provided || !safeEqual(provided, expected)) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }

        const url = process.env.SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!url || !serviceKey) {
          return new Response(
            JSON.stringify({ error: "scanner not configured" }),
            { status: 500, headers: { "content-type": "application/json" } },
          );
        }

        const db = createClient<Database>(url, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        try {
          const { tickQueue } = await import("@/lib/scanner-service.server");
          const outcomes = await tickQueue(db);
          return Response.json({
            ok: true,
            picked: outcomes.length,
            outcomes: outcomes.map((o) => ({
              target: "username" in o ? `@${o.username}` : `📍 ${o.name}`,
              status: o.status,
              inserted: o.inserted,
              duplicates: o.duplicates,
              error: o.error,
            })),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[scanner-tick] failure", message);
          return new Response(JSON.stringify({ ok: false, error: message }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
      },
    },
  },
});
