import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/public/business-report/tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { businessTick } = await import("@/lib/business-report.server");
        return businessTick(request);
      },
    },
  },
});
