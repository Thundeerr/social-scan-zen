export type GenerationHistoryJob = {
  id: string;
  model: "kiikii" | "tuuva";
  state: string;
  issue: string | null;
  created_at: string;
  review_id: string | null;
  review: { id: string; title: string; revision: number; status: string } | null;
};

export const jobStateLabels: Record<string, string> = {
  queued: "Waiting for processing",
  working: "Preparing source",
  budget_wait: "Waiting for daily budget",
  reserved: "Preparing generation",
  generating: "Creating video",
  review: "Video ready",
  blocked: "Job needs attention",
};

export const jobIssueLabels: Record<string, string> = {
  source_unavailable: "Could not load the source.",
  duration: "The video duration is outside the allowed range.",
  validation: "A file could not be validated.",
  provider_uncertain: "Provider confirmation is missing. Do not submit again.",
  provider_failed: "The provider could not create the video.",
  setup: "The server configuration needs to be checked.",
};
