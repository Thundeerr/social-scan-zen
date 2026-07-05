import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const USERNAME_RE = /^[a-z0-9._]{1,32}$/;

function toDataUrl(contentType: string, buffer: ArrayBuffer) {
  const base64 = Buffer.from(buffer).toString("base64");
  return `data:${contentType || "image/jpeg"};base64,${base64}`;
}

export const getTrackedAccountAvatarsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { usernames: string[] }) =>
    z
      .object({
        usernames: z.array(z.string().min(1).max(64)).max(80),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const usernames = Array.from(
      new Set(
        data.usernames
          .map((u) => u.trim().replace(/^@/, "").toLowerCase())
          .filter((u) => USERNAME_RE.test(u)),
      ),
    );

    if (!usernames.length) return {} as Record<string, string>;

    const { data: rows, error } = await context.supabase
      .from("tracked_accounts")
      .select("username, avatar_url")
      .in("username", usernames);

    if (error) throw new Error(`Avatar lookup failed: ${error.message}`);

    const entries = await Promise.all(
      (rows ?? []).map(async (row) => {
        if (!row.avatar_url) return null;

        try {
          const response = await fetch(row.avatar_url, {
            headers: {
              Referer: "https://www.instagram.com/",
              "User-Agent": "Mozilla/5.0",
            },
          });

          if (!response.ok) return null;
          const contentType = response.headers.get("content-type") ?? "image/jpeg";
          if (!contentType.startsWith("image/")) return null;

          const buffer = await response.arrayBuffer();
          return [row.username, toDataUrl(contentType, buffer)] as const;
        } catch {
          return null;
        }
      }),
    );

    return Object.fromEntries(entries.filter(Boolean)) as Record<string, string>;
  });