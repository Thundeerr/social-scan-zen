import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/channel-alerts/tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { alertTick } = await import("@/lib/channel-alerts.server");
        return alertTick(request);
      },
    },
  },
});
