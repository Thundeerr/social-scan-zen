import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/model-pipeline/worker")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        (await import("@/lib/model-pipeline.server")).pipelineWorkerRequest(request),
    },
  },
});
