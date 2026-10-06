import { z } from "zod";

export const stages = ["Neu", "In Arbeit", "Verwendet"] as const;
export type ReelStage = (typeof stages)[number];
export function canonicalReel(input: string) {
  const url = new URL(input.trim());
  if (
    url.protocol !== "https:" ||
    !["instagram.com", "www.instagram.com", "m.instagram.com"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.port
  )
    throw new Error("Bitte einen HTTPS-Link zu einem Instagram-Reel verwenden.");
  const match = /^\/(?:reel|reels|p)\/([A-Za-z0-9_-]{5,64})\/?$/.exec(url.pathname);
  if (!match) throw new Error("Der Link führt nicht zu einem einzelnen Instagram-Reel.");
  return {
    shortcode: match[1],
    url: `https://www.instagram.com/${url.pathname.startsWith("/p/") ? "p" : "reel"}/${match[1]}/`,
  };
}
export function parseReelLinks(text: string) {
  const tokens = text
    .trim()
    .split(/[\s,;]+/)
    .filter(Boolean);
  if (!tokens.length || tokens.length > 50) throw new Error("Bitte 1 bis 50 Links einfügen.");
  return tokens.map((input) => {
    try {
      return { input, ...canonicalReel(input), error: null };
    } catch {
      return { input, url: null, shortcode: null, error: "Ungültiger Reel-Link" };
    }
  });
}
export const inboxAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), before: z.string().datetime().optional() }),
  z.object({
    action: z.literal("submit"),
    text: z.string().min(1).max(20000),
    test: z.boolean().default(false),
  }),
  z.object({ action: z.literal("move"), id: z.string().uuid(), stage: z.enum(stages) }),
  z.object({ action: z.literal("retry"), id: z.string().uuid() }),
  z.object({ action: z.literal("pair") }),
  z.object({ action: z.literal("revoke") }),
]);
export const workerAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("claim"), instance: z.string().uuid() }),
  z.object({ action: z.literal("renew"), id: z.string().uuid(), lease: z.string().uuid() }),
  z.object({
    action: z.literal("ack"),
    id: z.string().uuid(),
    lease: z.string().uuid(),
    receipt: z.object({
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      bytes: z.number().int().positive().max(536870912),
      stage: z.enum(stages),
      title: z.string().max(500),
      creator: z.string().max(200),
      duration: z.number().positive().max(3600),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      thumbnail: z
        .string()
        .max(180000)
        .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/)
        .optional(),
      gallery: z.boolean(),
      folder: z.string().regex(/^(Neu|In Arbeit|Verwendet)\/[A-Za-z0-9_-]{5,64}_[a-f0-9-]{36}$/),
    }),
  }),
  z.object({
    action: z.literal("fail"),
    id: z.string().uuid(),
    lease: z.string().uuid(),
    code: z.enum([
      "unavailable",
      "unsupported",
      "interrupted",
      "validation",
      "path_blocked",
      "disk_error",
      "conflict",
      "setup",
    ]),
  }),
]);
export type ReelItem = {
  id: string;
  shortcode: string;
  canonical_url: string;
  status: "queued" | "working" | "ready" | "failed";
  desired_stage: ReelStage;
  confirmed_stage: ReelStage | null;
  is_test: boolean;
  error_code: string | null;
  created_at: string;
  updated_at: string;
  receipt: Record<string, unknown> | null;
};
export type InboxSnapshot = {
  items: ReelItem[];
  device: { last_seen_at: string | null; revoked: boolean } | null;
};
