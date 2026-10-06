import { z } from "zod";
import { canonicalReel } from "./reel-inbox";

export const DM_RECEIVER = "followerstarteam";
export const DM_SENDERS = ["kiikii.bat", "thundeerr999"] as const;
export const DM_WEBHOOK = "https://instascanner.app/api/public/instagram/inbox-webhook";
const id = z.string().regex(/^[0-9]{1,40}$/);
const message = z.object({
  sender: z.object({ id }),
  recipient: z.object({ id }),
  message: z
    .object({
      mid: z.string().min(1).max(2000),
      is_echo: z.boolean().optional(),
      is_deleted: z.boolean().optional(),
      text: z.string().max(20000).optional(),
      attachments: z
        .array(
          z.object({
            type: z.string(),
            payload: z.object({ url: z.string().max(8000).optional() }).passthrough(),
          }),
        )
        .max(50)
        .optional(),
    })
    .optional(),
});
const envelope = z.object({
  object: z.literal("instagram"),
  entry: z.array(z.object({ id, messaging: z.array(z.unknown()).max(100).optional() })).max(100),
});

export function dmEvents(body: unknown) {
  const parsed = envelope.safeParse(body);
  if (!parsed.success) throw new Error("Invalid envelope");
  return parsed.data.entry.flatMap((entry) =>
    (entry.messaging ?? []).flatMap((raw) => {
      const event = message.safeParse(raw);
      if (
        !event.success ||
        !event.data.message ||
        event.data.message.is_echo ||
        event.data.message.is_deleted ||
        event.data.recipient.id !== entry.id ||
        event.data.sender.id === entry.id
      )
        return [];
      const data = event.data.message;
      const candidates = [
        ...(data.text?.match(/https:\/\/[^\s<>"']+/g) ?? []),
        ...(data.attachments ?? [])
          .filter((a) => a.type === "share" || a.type === "ig_reel" || a.type === "reel")
          .map((a) => a.payload.url ?? ""),
      ];
      const links = new Map<string, ReturnType<typeof canonicalReel>>();
      for (const candidate of candidates) {
        try {
          const link = canonicalReel(candidate.replace(/[).,;!]+$/, ""));
          links.set(link.shortcode, link);
        } catch {
          /* Never fetch arbitrary attachment URLs. */
        }
      }
      if (links.size > 50) throw new Error("Too many links");
      return [
        {
          receiver: entry.id,
          sender: event.data.sender.id,
          mid: data.mid,
          links: [...links.values()],
        },
      ];
    }),
  );
}
