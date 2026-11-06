import { z } from "zod";
import replies from "./kiikii-dm-replies.json";

export const KIIKII_ID = "17841416918437774";
export const DM_SCOPE = "instagram_business_manage_messages";
export const DM_LINK = "https://chat.kiiki.info";
export const DM_REPLIES: readonly string[] = replies.messages;
export const RESPONSE_WINDOW_MS = (24 * 60 - 1) * 60_000;
const id = z.string().regex(/^\d{1,40}$/);
const envelope = z.object({
  object: z.literal("instagram"),
  entry: z.array(z.object({ id, messaging: z.array(z.unknown()).max(100).optional() })).max(100),
});
const eventSchema = z.object({
  sender: z.object({ id }),
  recipient: z.object({ id }),
  timestamp: z.number().int().positive(),
  message: z.object({
    mid: z.string().min(1).max(2000),
    text: z.string().max(20000).optional(),
    is_echo: z.boolean().optional(),
    is_deleted: z.boolean().optional(),
    is_unsupported: z.boolean().optional(),
    attachments: z.array(z.unknown()).max(50).optional(),
  }),
});
export function isOptOut(text = "") {
  // Normalize decoration only at the edges. Removing arbitrary words or emoji
  // inside a sentence could turn ordinary conversation into a STOP request.
  const undecorate = (value: string) =>
    value.replace(/^[\s\p{P}\p{S}\uFE0E\uFE0F\u200D]+|[\s\p{P}\p{S}\uFE0E\uFE0F\u200D]+$/gu, "");
  let normalized = undecorate(
    text.normalize("NFKC").replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim(),
  );
  normalized = undecorate(normalized.replace(/^(?:please|bitte)\b[\s,:;!.-]*/i, ""));
  normalized = undecorate(normalized.replace(/[\s,:;!.-]+(?:please|bitte)$/i, ""));
  return /^(?:stop|stopp|unsubscribe|stop messaging me|stop sending me messages|do not message me|don't message me|dont message me|no more messages|keine nachrichten mehr|schreib(?:e)? mir (?:bitte )?nicht mehr|abmelden)$/i.test(normalized);
}
export function websiteDmEvents(body: unknown, now = Date.now()) {
  return envelope.parse(body).entry.flatMap((entry) =>
    (entry.messaging ?? []).flatMap((raw) => {
      const parsed = eventSchema.safeParse(raw);
      if (!parsed.success) return [];
      const e = parsed.data;
      if (
        entry.id !== KIIKII_ID ||
        e.recipient.id !== entry.id ||
        e.sender.id === entry.id ||
        e.message.is_echo ||
        e.message.is_deleted ||
        e.message.is_unsupported ||
        (!e.message.text?.trim() && !e.message.attachments?.length) ||
        e.timestamp < now - RESPONSE_WINDOW_MS ||
        e.timestamp > now + 300_000
      )
        return [];
      return [
        {
          sender: e.sender.id,
          receiver: entry.id,
          mid: e.message.mid,
          timestamp: e.timestamp,
          stop: isOptOut(e.message.text),
        },
      ];
    }),
  );
}
