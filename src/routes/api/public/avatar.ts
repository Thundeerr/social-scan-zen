import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Proxy for tracked-account avatars.
 *
 * Instagram's CDN sets `cross-origin-resource-policy: same-origin`, so the
 * signed URLs we store cannot be loaded directly in <img> from our origin.
 * We proxy them here (server → IG CDN → us → browser) and cache aggressively.
 *
 * GET /api/public/avatar?u=<username>
 */
export const Route = createFileRoute("/api/public/avatar")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const username = (url.searchParams.get("u") ?? "").trim().toLowerCase();
        if (!username || !/^[a-z0-9._]{1,32}$/.test(username)) {
          return new Response("bad username", { status: 400 });
        }

        const supabase = createClient<Database>(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_PUBLISHABLE_KEY!,
          { auth: { persistSession: false, autoRefreshToken: false, storage: undefined } },
        );
        const { data } = await supabase
          .from("tracked_accounts")
          .select("avatar_url")
          .eq("username", username)
          .maybeSingle();

        const src = data?.avatar_url;
        if (!src) return new Response("no avatar", { status: 404 });

        const upstream = await fetch(src, {
          headers: { Referer: "https://www.instagram.com/", "User-Agent": "Mozilla/5.0" },
        });
        if (!upstream.ok || !upstream.body) {
          return new Response("upstream error", { status: 502 });
        }

        return new Response(upstream.body, {
          status: 200,
          headers: {
            "content-type": upstream.headers.get("content-type") ?? "image/jpeg",
            "cache-control": "public, max-age=3600, s-maxage=86400",
            "cross-origin-resource-policy": "cross-origin",
          },
        });
      },
    },
  },
});
