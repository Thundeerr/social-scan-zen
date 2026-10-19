import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { pipelineCommand } from "./model-pipeline.server";
import type { GenerationHistoryJob } from "./generation-history";

export async function generationHistory(user: string): Promise<{
  enabled: boolean;
  jobs: GenerationHistoryJob[];
}> {
  const status = await pipelineCommand("status", user);
  const jobs = (status.jobs ?? []) as Omit<GenerationHistoryJob, "review">[];
  const ids = [...new Set(jobs.flatMap((job) => (job.review_id ? [job.review_id] : [])))];
  const reviews = new Map<string, NonNullable<GenerationHistoryJob["review"]>>();
  if (ids.length) {
    const result = await (supabaseAdmin as SupabaseClient)
      .from("content_review_items")
      .select("id,title,revision,status")
      .eq("user_id", user)
      .in("id", ids);
    if (result.error) throw Error("Ergebnisse konnten nicht geladen werden.");
    for (const review of result.data ?? []) reviews.set(review.id, review);
  }
  return {
    enabled: status.enabled === true,
    jobs: jobs.map((job) => ({
      id: job.id,
      model: job.model,
      state: job.state,
      issue: job.issue,
      created_at: job.created_at,
      review_id: job.review_id,
      review: job.review_id ? (reviews.get(job.review_id) ?? null) : null,
    })),
  };
}
