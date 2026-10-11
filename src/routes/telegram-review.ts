import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/telegram-review")({
  server: {
    handlers: {
      GET: async () => (await import("@/lib/telegram-review-page.server")).telegramReviewPage(),
    },
  },
});
