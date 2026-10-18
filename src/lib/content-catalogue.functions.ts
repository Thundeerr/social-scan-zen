import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { catalogueFilterSchema } from "./content-catalogue";

const assignment = z.enum(["unassigned", "wall", "ppv"]);

export const catalogueListFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({
    clip_page: z.number().int().min(0).max(100000).default(0),
    review_page: z.number().int().min(0).max(100000).default(0),
    filters: catalogueFilterSchema.default({}),
  }).strict())
  .handler(async ({ data, context }) => {
    const { data: auth, error } = await context.supabase.auth.getUser();
    if (error || auth.user?.id !== context.userId || auth.user.is_anonymous)
      throw new Error("Bitte erneut anmelden.");
    const { listCatalogue } = await import("./content-catalogue.server");
    return listCatalogue(context.userId, data.clip_page, data.review_page, data.filters);
  });

export const setClipAssignmentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({
    clip_id: z.string().uuid(),
    assignment,
    expected_assignment: assignment,
  }).strict())
  .handler(async ({ data, context }) => {
    const { data: auth, error } = await context.supabase.auth.getUser();
    if (error || auth.user?.id !== context.userId || auth.user.is_anonymous)
      throw new Error("Bitte erneut anmelden.");
    const { setClipAssignment } = await import("./content-catalogue.server");
    return setClipAssignment(context.userId, data);
  });

export const promoteReviewItemToClipFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      review_item_id: z.string().uuid(),
      clip_code: z.string().regex(/^(KII|TUU)-V[0-9]{3,}$/),
      pipeline_job_id: z.string().uuid().optional(),
    }).strict(),
  )
  .handler(async ({ data, context }) => {
    const { data: auth, error } = await context.supabase.auth.getUser();
    if (error || auth.user?.id !== context.userId || auth.user.is_anonymous)
      throw new Error("Bitte erneut anmelden.");
    const { promoteReviewItemToClip } = await import("./content-catalogue.server");
    return promoteReviewItemToClip(context.userId, data);
  });
