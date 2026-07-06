/**
 * Diagnostics for the Instagram location provider.
 *
 * Exposes:
 *  - locationProviderStatusFn: which RAPIDAPI_LOCATION_* env vars are set
 *    (booleans only — never returns the values themselves).
 *  - testLocationFetchFn: hits the live location endpoint with a sample id
 *    and returns metadata + a small post preview. NEVER writes to the DB.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const locationProviderStatusFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const host = process.env.RAPIDAPI_HOST ?? null;
    const keySet = !!process.env.RAPIDAPI_KEY;
    const path = process.env.RAPIDAPI_LOCATION_PATH ?? null;
    const idParam = process.env.RAPIDAPI_LOCATION_ID_PARAM ?? null;
    const extra = process.env.RAPIDAPI_LOCATION_EXTRA_PARAMS ?? null;
    // Defaults the provider falls back to when the vars are missing.
    const effectivePath = path ?? "/location-feeds";
    const effectiveIdParam = idParam ?? "id";
    return {
      host,
      keySet,
      pathSet: !!path,
      idParamSet: !!idParam,
      extraSet: !!extra,
      // Expose only lengths / presence for the extras — the value itself is
      // not secret but we keep the surface tight for consistency.
      extraKeys: extra
        ? Array.from(new URLSearchParams(extra).keys())
        : [],
      effectivePath,
      effectiveIdParam,
      exampleUrl: host
        ? `https://${host}${effectivePath}?${effectiveIdParam}=<location_id>`
        : null,
    };
  });

export const testLocationFetchFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { locationId: string }) =>
    z
      .object({
        locationId: z
          .string()
          .trim()
          .regex(/^\d{3,20}$/u, "Location id must be 3–20 digits"),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const started = Date.now();
    try {
      const { getInstagramProviderFromEnv } = await import(
        "@/lib/instagram-provider.server"
      );
      const provider = getInstagramProviderFromEnv();
      const res = await provider.fetchLocation(data.locationId);
      const first = res.posts[0] ?? null;
      return {
        ok: true as const,
        elapsedMs: Date.now() - started,
        locationId: res.location_id,
        name: res.name,
        postCount: res.posts.length,
        firstPost: first
          ? {
              external_id: first.external_id,
              media_type: first.media_type,
              caption: first.caption.slice(0, 140),
              likes: first.likes,
              comments: first.comments,
              posted_at: first.posted_at,
              source_url: first.source_url,
              thumbnail_url: first.thumbnail_url,
            }
          : null,
      };
    } catch (err) {
      return {
        ok: false as const,
        elapsedMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
