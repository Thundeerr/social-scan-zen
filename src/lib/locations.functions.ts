/**
 * Locations server functions — mirrors scanner.functions.ts for Instagram
 * location IDs. All provider access happens server-side inside handlers.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const LOCATION_ID_RE = /^\d{3,20}$/;

export const searchLocationsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { query: string }) =>
    z.object({ query: z.string().trim().min(1).max(120) }).parse(data),
  )
  .handler(async ({ data }) => {
    const { searchLocations } = await import("@/lib/instagram-provider.server");
    return searchLocations(data.query);
  });

export const scanLocationNowFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { locationRowId: string }) =>
    z.object({ locationRowId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { scanLocationNow } = await import("@/lib/scanner-service.server");
    return scanLocationNow(context.supabase, data.locationRowId);
  });

export const scanSingleLocationFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { locationId: string; name?: string }) =>
    z
      .object({
        locationId: z.string().min(1).max(32),
        name: z.string().min(1).max(120).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const rawId = data.locationId.trim();
    if (!LOCATION_ID_RE.test(rawId)) {
      throw new Error("Invalid Instagram location id (numeric, 3–20 digits)");
    }
    const supabase = context.supabase;

    // Resolve or create the tracked_locations row.
    const { data: existing, error: lookupErr } = await supabase
      .from("tracked_locations")
      .select("id")
      .eq("created_by", context.userId)
      .eq("location_id", rawId)
      .maybeSingle();
    if (lookupErr) throw new Error(`Lookup failed: ${lookupErr.message}`);

    let rowId = existing?.id ?? null;
    if (!rowId) {
      const { data: created, error } = await supabase
        .from("tracked_locations")
        .insert({
          location_id: rawId,
          name: data.name ?? `Location ${rawId}`,
          status: "active",
          tier: "B",
          created_by: context.userId,
        })
        .select("id")
        .single();
      if (error || !created) {
        throw new Error(`Could not track location: ${error?.message ?? "unknown"}`);
      }
      rowId = created.id;
    }

    const { scanLocationNow } = await import("@/lib/scanner-service.server");
    return scanLocationNow(supabase, rowId);
  });
