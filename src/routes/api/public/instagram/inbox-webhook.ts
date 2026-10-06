import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/public/instagram/inbox-webhook")({
  server: {
    handlers: {
      GET: async ({ request }) => (await import("@/lib/reel-inbox-dm.server")).dmWebhook(request),
      POST: async ({ request }) => (await import("@/lib/reel-inbox-dm.server")).dmWebhook(request),
    },
  },
});
