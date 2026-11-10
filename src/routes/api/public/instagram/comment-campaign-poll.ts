import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/public/instagram/comment-campaign-poll")({
  server: { handlers: { POST: async ({ request }) =>
    (await import("@/lib/kiikii-comment-campaigns.server")).campaignPoll(request) } },
});
