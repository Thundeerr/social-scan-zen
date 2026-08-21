/**
 * Instagram OAuth redirect target.
 *
 * Public by necessity (Meta redirects the browser here without an app
 * session), but it carries no authority of its own: the operator identity
 * comes exclusively from the one-time, expiring OAuth state row that the
 * authenticated `startInstagramOAuthFn` created. The authorization code is
 * exchanged server-side and never echoed back to the browser.
 */

import { createFileRoute } from "@tanstack/react-router";
import { parseCallbackParams } from "@/lib/instagram-oauth";

function backToPublisher(origin: string, params: Record<string, string>) {
  const url = new URL("/publisher", origin);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return new Response(null, { status: 302, headers: { location: url.toString() } });
}

export const Route = createFileRoute("/api/public/instagram/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const origin = url.origin;
        const parsed = parseCallbackParams(url.searchParams);
        if (!parsed.ok) {
          return backToPublisher(origin, { ig_error: parsed.error });
        }

        try {
          const { completeInstagramConnection } = await import(
            "@/lib/instagram-oauth.server"
          );
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const result = await completeInstagramConnection(supabaseAdmin, {
            code: parsed.code,
            state: parsed.state,
          });
          if (!result.ok) return backToPublisher(origin, { ig_error: result.error });
          return backToPublisher(origin, { ig: "connected", ig_user: result.username });
        } catch {
          return backToPublisher(origin, {
            ig_error: "Instagram connection failed. Please try again.",
          });
        }
      },
    },
  },
});
