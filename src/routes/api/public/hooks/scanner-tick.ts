/**
 * Autonomous scanner tick — called by pg_cron every minute.
 *
 * The route is public so pg_cron can reach it without a user session, but it
 * authenticates the caller with the Supabase anon key (standard Lovable
 * pattern for scheduled work) and does all writes through the service role
 * so RLS's operator-only INSERT/UPDATE policies still hold.
 */

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export const Route = createFileRoute("/api/public/hooks/scanner-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey =
          request.headers.get("apikey") ?? request.headers.get("x-api-key");
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!expected || apiKey !== expected) {
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
              username: o.username,
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
