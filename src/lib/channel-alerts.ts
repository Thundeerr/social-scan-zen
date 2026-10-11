import { z } from "zod";
export const alertAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status") }),
  z.object({ action: z.literal("check"), model: z.enum(["kiikii", "tuuva"]) }),
  z.object({
    action: z.literal("configure"),
    model: z.enum(["kiikii", "tuuva"]),
    enabled: z.boolean().optional(),
    connection_id: z.string().uuid().nullable().optional(),
  }),
]);
export type AlertAction = z.infer<typeof alertAction>;
export type AlertChannel = {
  model: "kiikii" | "tuuva";
  chat_id: string;
  ig_username: string | null;
  enabled: boolean;
  bot_ready: boolean;
  checked_at: string | null;
};
export type AlertSnapshot = {
  channels: AlertChannel[];
  connections: { id: string; username: string }[];
  alerts: {
    id: string;
    model: string;
    state: string;
    sent_at: string | null;
    delete_after: string | null;
    error_code: string | null;
  }[];
  last_tick: string | null;
};
export function announcement(model: "kiikii" | "tuuva", permalink: string) {
  if (!/^https:\/\/www\.instagram\.com\/(reel|p)\/[A-Za-z0-9_-]+\/$/.test(permalink))
    throw new Error("Invalid Instagram permalink");
  const text =
    model === "kiikii" ? "New post is up 🦇\nCome say hi 🖤" : "New post is up ❄️\nCome say hi 🤍";
  return {
    text,
    reply_markup: { inline_keyboard: [[{ text: "Watch on Instagram", url: permalink }]] },
    link_preview_options: { is_disabled: true },
  };
}
