/**
 * Server functions the publisher UI calls to start / end the official
 * Instagram connection. Tokens never cross this boundary.
 */

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildAuthorizeUrl, instagramOAuthCallbackUrl } from "./instagram-oauth";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { IG_INSIGHTS_SCOPE } from "./instagram-analytics";
import { IG_SCOPES } from "./instagram-oauth";

export const startInstagramOAuthFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z
      .object({
        destination: z.enum(["followerstar", "kiikii", "tuuva"]),
        insights: z.boolean().optional(),
      })
      .optional(),
  )
  .handler(async ({ context, data }) => {
    const { instagramAppCredentials, createOAuthState } = await import("./instagram-oauth.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { clientId } = instagramAppCredentials();
    const { data: roles, error } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (error || !roles?.some((r) => r.role === "owner" || r.role === "cofounder"))
      throw new Error("Not authorized");

    // Meta compares redirect URIs exactly. Never derive this from preview,
    // localhost, or the www host (which redirects to the apex domain).
    const redirectUri = instagramOAuthCallbackUrl();
    const state = await createOAuthState(
      supabaseAdmin,
      context.userId,
      redirectUri,
      data?.destination ?? "followerstar",
    );

    // Analytics is optional; existing publishing connections keep their scopes.
    return {
      authorizeUrl: buildAuthorizeUrl({
        clientId,
        redirectUri,
        state,
        scopes: data?.insights ? [...IG_SCOPES, IG_INSIGHTS_SCOPE] : IG_SCOPES,
      }),
    };
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

    const { error } = await (supabaseAdmin as SupabaseClient)
      .from("ig_connections")
      .delete()
      .eq("user_id", context.userId)
      .eq("destination", "followerstar");
    if (error) throw new Error(error.message);

    return { ok: true as const };
  });
