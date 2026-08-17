/**
 * Cron endpoint for the Private→Public monitor.
 *
 * Public prefix so pg_cron can reach it without a session; authorised with a
 * constant-time comparison against CRON_SECRET (or the publishable key).
 */

import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

async function handle(request: Request) {
  const secrets = [process.env.CRON_SECRET, process.env.SUPABASE_PUBLISHABLE_KEY].filter(
    (v): v is string => Boolean(v),
  );
  if (secrets.length === 0) {
    return Response.json({ error: "cron secret not configured" }, { status: 503 });
  }

  const provided =
    request.headers.get("x-cron-secret") ??
    request.headers.get("apikey") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";

  if (!provided || !secrets.some((s) => safeEqual(provided, s))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const { runScheduler } = await import("@/lib/monitor/monitor.server");
    const summary = await runScheduler(10);
    return Response.json({ ok: true, ...summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[monitor-cron] failure", message);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/cron/check")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
});
