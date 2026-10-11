import { z } from "zod";

export const models = { kiikii: "Kiikii", tuuva: "Tuuva" } as const;
export const MAX_REVIEW_BYTES = 40 * 1024 * 1024;
const item = { id: z.string().uuid(), revision: z.number().int().positive() };
export const reviewAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list") }),
  z.object({
    action: z.literal("create"),
    model: z.enum(["kiikii", "tuuva"]),
    title: z.string().trim().min(1).max(160),
    caption: z.string().max(2200),
  }),
  z.object({ action: z.literal("upload"), ...item }),
  z.object({ action: z.literal("finalize"), ...item }),
  z.object({ action: z.literal("preview"), ...item }),
  z.object({ action: z.literal("notify"), ...item }),
  z.object({ action: z.literal("edit"), ...item, caption: z.string().max(2200) }),
  z.object({
    action: z.literal("decide"),
    ...item,
    decision: z.enum(["approved", "rejected", "changes"]),
    note: z.string().max(2000).default(""),
  }),
]);
export type ReviewAction = z.infer<typeof reviewAction>;
export type ReviewItem = {
  id: string;
  model: keyof typeof models;
  title: string;
  caption: string;
  revision: number;
  status: "uploading" | "pending" | "approved" | "rejected" | "changes";
  media_path: string;
  notification: "none" | "sending" | "sent" | "uncertain";
  note: string;
  sha256: string | null;
  bytes: number | null;
  created_at: string;
  publish_post_id?: string | null;
};
export type ReviewResult = {
  items?: ReviewItem[];
  item?: ReviewItem;
  token?: string;
  path?: string;
  url?: string;
  telegramReady?: boolean;
};

export function reviewCard(item: ReviewItem, origin: string, chatId: string) {
  const url = new URL("/content-review", origin);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("HTTPS required");
  url.searchParams.set("item", item.id);
  return {
    chat_id: chatId,
    caption: `${models[item.model]} · Reel-Freigabe · Version ${item.revision}\n${item.title}\n\nVideo und Caption in InstaScanner prüfen. Freigeben veröffentlicht noch nichts.`,
    reply_markup: {
      inline_keyboard: [[{ text: `${models[item.model]}: Prüfen & freigeben`, url: url.href }]],
    },
    protect_content: true,
  };
}
