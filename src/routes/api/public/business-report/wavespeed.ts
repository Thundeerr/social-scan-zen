import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/public/business-report/wavespeed")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        (await import("@/lib/wavespeed-analytics.server")).waveCollector(request),
      POST: async ({ request }) =>
        (await import("@/lib/wavespeed-analytics.server")).waveCollector(request),
    },
  },
});
