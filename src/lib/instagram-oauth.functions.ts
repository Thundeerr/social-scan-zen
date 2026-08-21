/**
 * Server functions the publisher UI calls to start / end the official
 * Instagram connection. Tokens never cross this boundary.
 */

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildAuthorizeUrl, instagramOAuthCallbackUrl } from "./instagram-oauth";

export const startInstagramOAuthFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { instagramAppCredentials, createOAuthState } = await import("./instagram-oauth.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { clientId } = instagramAppCredentials();

    // Meta compares redirect URIs exactly. Never derive this from preview,
    // localhost, or the www host (which redirects to the apex domain).
    const redirectUri = instagramOAuthCallbackUrl();
    const state = await createOAuthState(supabaseAdmin, context.userId, redirectUri);

    return { authorizeUrl: buildAuthorizeUrl({ clientId, redirectUri, state }) };
  });

export const disconnectInstagramFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Never disconnect while work is in flight — content history is untouched.
    const { count, error: countError } = await supabaseAdmin
      .from("content_posts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId)
      .in("status", ["scheduled", "publishing"]);
    if (countError) throw new Error(countError.message);
    if ((count ?? 0) > 0) {
      throw new Error(
        `${count} post(s) are still scheduled or publishing. Unschedule them before disconnecting.`,
      );
    }

    // Pause publishing first, then drop only this operator's connection.
    const { error: pauseError } = await supabaseAdmin
      .from("profiles")
      .update({ publishing_paused: true })
      .eq("id", context.userId);
    if (pauseError) throw new Error(pauseError.message);

    const { error } = await supabaseAdmin
      .from("ig_connections")
      .delete()
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);

    return { ok: true as const };
  });
