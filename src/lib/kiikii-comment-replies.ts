import { z } from "zod";
import { isOptOut, KIIKII_ID } from "./kiikii-dm-redirect";

export const COMMENT_SCOPE = "instagram_business_manage_comments";
// Heart CTAs were verified in the stored published captions on 2026-11-03.
export const HEARTS = "❤♥♡❥❣💔💕💞💓💗💖💘💝💟🖤🤍🤎💜💙💚💛🧡🩷🩵🩶🫶🫀";
const id = z.string().regex(/^\d{1,40}$/);
const valueSchema = z.object({
  id: id.optional(),
  comment_id: id.optional(),
  from: z.object({ id, username: z.string().min(1).max(100) }),
  media: z.object({ id, media_product_type: z.string().optional() }),
  parent_id: id.nullish(),
  text: z.string().max(20000).optional(),
});
const notification = z.object({ field: z.string(), value: z.unknown() });
const envelope = z.object({
  object: z.literal("instagram"),
  entry: z
    .array(
      z.object({
        id,
        time: z.number().positive().optional(),
        changes: z.array(z.unknown()).max(100).optional(),
        field: z.string().optional(),
        value: z.unknown().optional(),
      }),
    )
    .max(100),
});
const normalize = (text: string) =>
  text
    .normalize("NFKC")
    .replace(/[\uFE0E\uFE0F\u200D]/g, "")
    .replace(/&lt;/gi, "<");

/** Explicit caption instructions only. Decorative emoji elsewhere are not CTAs. */
export function captionTriggers(caption: string) {
  const tokens = new Set<string>();
  const pattern =
    /\b(?:comment|drop|leave|kommentier(?:e|t)?|schreib(?:e|t)?)\s+(?:(?:a|an|the|ein|eine)\s+)?(?:["'“‘„«]([^"'”’“»\n]{1,24})["'”’“»]|(<\s*3+)|((?:\p{Extended_Pictographic}[\uFE0E\uFE0F\u200D\p{Emoji_Modifier}]*)+)|\b(CHAT|LINK|INFO|MORE|YES|ME|DM)\b)/giu;
  for (const match of normalize(caption).matchAll(pattern)) {
    const token = (match[1] ?? match[2] ?? match[3] ?? match[4]).trim().toLowerCase();
    if (token && token.length <= 24) tokens.add(token);
  }
  return [...tokens];
}

export function commentTrigger(text: string, caption = ""): string | null {
  if (isOptOut(text)) return null;
  const normalized = normalize(text).toLowerCase();
  if (/<\s*3+(?!\d)/.test(normalized)) return "heart";
  if ([...normalized].some((c) => HEARTS.includes(c))) return "heart";
  for (const token of captionTriggers(caption)) {
    // Avoid matching CHAT inside "chatbot", or a number inside a larger number.
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, "iu").test(normalized))
      return "caption_cta";
  }
  return null;
}

export function websiteCommentEvents(body: unknown, now = Date.now()) {
  const parsed = envelope.safeParse(body);
  if (!parsed.success) return [];
  return parsed.data.entry.flatMap((entry) => {
    if (entry.id !== KIIKII_ID) return [];
    // Meta examples use both changes[] and direct field/value entries.
    return (entry.changes ?? [entry]).flatMap((raw) => {
      const change = notification.safeParse(raw);
      if (!change.success || change.data.field !== "comments") return [];
      const value = valueSchema.safeParse(change.data.value);
      if (!value.success) return [];
      const v = value.data;
      const comment = v.id ?? v.comment_id;
      const time = entry.time && (entry.time < 1e12 ? entry.time * 1000 : entry.time);
      if (
        !comment ||
        v.parent_id ||
        v.from.id === KIIKII_ID ||
        v.from.username.toLowerCase() === "kiikii.bat" ||
        (time && (time < now - 86400000 || time > now + 300000)) ||
        ["LIVE", "STORY", "AD"].includes(v.media.media_product_type?.toUpperCase() ?? "")
      )
        return [];
      return [
        { comment, sender: v.from.id, username: v.from.username.toLowerCase(), media: v.media.id },
      ];
    });
  });
}

export const verifiedCommentSchema = z.object({
  id,
  text: z.string().max(20000),
  timestamp: z.string(),
  // The individual comment endpoint may omit from.id even when the comments
  // edge and signed webhook include it. Bind the returned username as well.
  from: z.object({ id: id.optional(), username: z.string().min(1).max(100) }),
  media: z.object({ id }),
  parent_id: id.nullish(),
  hidden: z.boolean().optional(),
});
export const verifiedMediaSchema = z.object({
  id,
  owner: z.object({ id }),
  caption: z.string().max(20000).optional(),
  permalink: z
    .string()
    .regex(/^https:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\/[A-Za-z0-9_-]+\/?(?:\?[^\s]*)?$/),
});
