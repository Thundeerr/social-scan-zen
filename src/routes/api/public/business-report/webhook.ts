import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/public/business-report/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { businessWebhook } = await import("@/lib/business-report.server");
        return businessWebhook(request);
      },
    },
  },
});
