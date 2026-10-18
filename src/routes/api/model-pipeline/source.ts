import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/model-pipeline/source")({
  server: { handlers: { GET: async ({ request }) =>
    (await import("@/lib/generation.server")).generationSourceRequest(request) } },
});
