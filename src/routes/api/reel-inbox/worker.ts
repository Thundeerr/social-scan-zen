import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/reel-inbox/worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { workerRequest } = await import("@/lib/reel-inbox.server");
        return workerRequest(request);
      },
    },
  },
});
