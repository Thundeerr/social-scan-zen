import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { CatalogueClip, CatalogueSnapshot, ClipAssignment, CatalogueFilters } from "./content-catalogue";

export interface PromoteReviewInput {
  review_item_id: string;
  clip_code: string;
  pipeline_job_id?: string;
}

const publicErrors = new Set([
  "Catalogue owner required",
  "Review not found",
  "Review must be approved",
  "Invalid clip code for character",
  "Pipeline job does not match review",
  "Review already promoted with different details",
  "Invalid assignment",
  "Clip not found",
  "Clip is inside an offer",
  "Assignment changed; refresh catalogue",
]);

// userId must come from verified authentication, not the request body.
export async function promoteReviewItemToClip(
  userId: string,
  input: PromoteReviewInput,
): Promise<CatalogueClip> {
  const { data, error } = await (supabaseAdmin as SupabaseClient).rpc(
    "promote_review_item_to_clip",
    {
      p_user: userId,
      p_review_item_id: input.review_item_id,
      p_clip_code: input.clip_code,
      p_pipeline_job_id: input.pipeline_job_id ?? null,
    },
  );
  if (error) {
    if (error.code === "23505")
      throw new Error("Clip code or review is already registered. Refresh the catalogue.");
    throw new Error(
      publicErrors.has(error.message) ? error.message : "Clip promotion failed. Please retry.",
    );
  }
  if (!data) throw new Error("Clip promotion returned no record.");
  return data as CatalogueClip;
}

function catalogueError(error: { message: string }): Error {
  return new Error(
    publicErrors.has(error.message)
      ? error.message
      : "Catalogue unavailable. Check that the catalogue migrations are installed.",
  );
}

export async function listCatalogue(
  userId: string, clipPage: number, reviewPage: number, filters: CatalogueFilters,
): Promise<CatalogueSnapshot> {
  const { data, error } = await (supabaseAdmin as SupabaseClient).rpc("catalogue_snapshot", {
    p_user: userId, p_clip_page: clipPage, p_review_page: reviewPage, p_filters: filters,
  });
  if (error) throw catalogueError(error);
  if (!data) throw new Error("Catalogue returned no data.");
  return data as CatalogueSnapshot;
}

export async function setClipAssignment(
  userId: string,
  input: { clip_id: string; assignment: ClipAssignment; expected_assignment: ClipAssignment },
): Promise<CatalogueClip> {
  const { data, error } = await (supabaseAdmin as SupabaseClient).rpc("set_catalogue_clip_assignment", {
    p_user: userId,
    p_clip_id: input.clip_id,
    p_assignment: input.assignment,
    p_expected_assignment: input.expected_assignment,
  });
  if (error) throw catalogueError(error);
  if (!data) throw new Error("Assignment change returned no record.");
  return data as CatalogueClip;
}
