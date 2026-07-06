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

      // Also do a raw fetch to expose the response shape so the operator can
      // see what came back when the parser finds 0 posts. Best-effort only.
      let rawShape: {
        topLevelKeys: string[];
        firstArrayPath: string | null;
        firstArrayLength: number | null;
        preview: string | null;
      } | null = null;
      if (res.posts.length === 0) {
        try {
          const host = process.env.RAPIDAPI_HOST!;
          const key = process.env.RAPIDAPI_KEY!;
          const path = process.env.RAPIDAPI_LOCATION_PATH ?? "/location-feeds";
          const idParam = process.env.RAPIDAPI_LOCATION_ID_PARAM ?? "id";
          const url = new URL(`https://${host}${path}`);
          url.searchParams.set(idParam, data.locationId);
          const extra = process.env.RAPIDAPI_LOCATION_EXTRA_PARAMS ?? "";
          for (const [k, v] of new URLSearchParams(extra)) url.searchParams.set(k, v);
          const raw = await fetch(url.toString(), {
            headers: { "X-RapidAPI-Key": key, "X-RapidAPI-Host": host },
          });
          const text = await raw.text();
          let json: unknown = null;
          try { json = JSON.parse(text); } catch { /* ignore */ }
          const root = (json ?? {}) as Record<string, unknown>;
          const topLevelKeys = json && typeof json === "object" && !Array.isArray(json)
            ? Object.keys(root).slice(0, 20)
            : [];
          // Find the first non-empty array anywhere in the tree.
          let firstArrayPath: string | null = null;
          let firstArrayLength: number | null = null;
          const stack: Array<[string, unknown]> = [["$", json]];
          const seen = new WeakSet<object>();
          while (stack.length) {
            const [p, v] = stack.shift()!;
            if (!v || typeof v !== "object" || seen.has(v as object)) continue;
            seen.add(v as object);
            if (Array.isArray(v)) {
              if (v.length > 0 && firstArrayPath === null) {
                firstArrayPath = p;
                firstArrayLength = v.length;
              }
              for (let i = 0; i < Math.min(v.length, 2); i++) stack.push([`${p}[${i}]`, v[i]]);
            } else {
              for (const [k, vv] of Object.entries(v as Record<string, unknown>)) {
                stack.push([`${p}.${k}`, vv]);
              }
            }
          }
          rawShape = {
            topLevelKeys,
            firstArrayPath,
            firstArrayLength,
            preview: text.slice(0, 400),
          };
        } catch { /* ignore diagnostics failure */ }
      }

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
        previewPosts: res.posts.slice(0, 6).map((p) => ({
          external_id: p.external_id,
          media_type: p.media_type,
          caption: p.caption.slice(0, 100),
          likes: p.likes,
          comments: p.comments,
          posted_at: p.posted_at,
          source_url: p.source_url,
          thumbnail_url: p.thumbnail_url,
        })),
        rawShape,
      };
    } catch (err) {
      return {
        ok: false as const,
        elapsedMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
