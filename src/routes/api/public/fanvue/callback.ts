import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/public/fanvue/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const cookie =
          request.headers
            .get("cookie")
            ?.split(";")
            .map((v) => v.trim())
            .find((v) => v.startsWith("__Host-fanvue-state="))
            ?.split("=")[1] ?? "";
        let status = "error";
        try {
          if (!url.searchParams.has("error")) {
            const { completeFanvue } = await import("@/lib/fanvue-analytics.server");
            await completeFanvue(
              url.searchParams.get("state") ?? "",
              cookie,
              url.searchParams.get("code") ?? "",
            );
            status = "connected";
          }
        } catch {
          /* Never expose OAuth codes, tokens or provider errors in responses/logs. */
        }
        return new Response(null, {
          status: 303,
          headers: {
            location: `/business?fanvue=${status}`,
            "cache-control": "no-store",
            "referrer-policy": "no-referrer",
            "set-cookie": "__Host-fanvue-state=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
          },
        });
      },
    },
  },
});
