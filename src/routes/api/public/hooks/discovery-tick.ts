/**
 * Discovery tick — public HTTP endpoint for pg_cron.
 * Same security model as scanner-tick: constant-time comparison against
 * CRON_SECRET, service-role Supabase client for the actual work.
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

export const Route = createFileRoute("/api/public/hooks/discovery-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.CRON_SECRET;
        if (!expected) {
          return new Response(JSON.stringify({ error: "cron secret not configured" }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
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
            JSON.stringify({ error: "discovery not configured" }),
            { status: 500, headers: { "content-type": "application/json" } },
          );
        }

        const db = createClient<Database>(url, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        try {
          const { tickDiscovery } = await import("@/lib/discovery-service.server");
          const result = await tickDiscovery(db);
          return Response.json({ ok: true, ...result });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[discovery-tick] failure", message);
          return new Response(JSON.stringify({ ok: false, error: message }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
      },
    },
  },
});
