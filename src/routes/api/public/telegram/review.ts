import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/public/telegram/review")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        (await import("@/lib/telegram-review.server")).telegramReviewRequest(request),
    },
  },
});
