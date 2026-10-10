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
      is_unsupported: z.boolean().optional(),
      text: z.string().max(20000).optional(),
      attachments: z
        .array(
          z.object({
            type: z.string(),
            payload: z.unknown().optional(),
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

export function dmReceiptExplanation(diagnostics: unknown): string {
  const outcome =
    diagnostics && typeof diagnostics === "object"
      ? (diagnostics as Record<string, unknown>).outcome
      : null;
  switch (outcome) {
    case "unsupported":
      return "Instagram meldet diese Nachricht als nicht unterstützt.";
    case "no_permalink":
      return "Der geteilte Anhang enthält keinen direkt nutzbaren Instagram-Reel-Link.";
    case "attachment_without_link":
      return "Ein Anhang wurde empfangen, aber kein nutzbarer Reel-Link übermittelt.";
    case "no_attachment":
      return "Die Nachricht enthält weder einen Anhang noch einen nutzbaren Reel-Link.";
    default:
      return "Kein nutzbarer Reel-Link enthalten; für ältere Nachrichten fehlen Diagnosedaten.";
  }
}

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
      const attachments = data.attachments ?? [];
      const shareTypes = new Set(["share", "ig_reel", "reel", "ig_post", "post"]);
      const attachmentUrls = attachments
        .filter((a) => shareTypes.has(a.type))
        .flatMap((a) => {
          const payload = a.payload;
          if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
          // Read only explicit link fields. Never scan captions/titles or infer a
          // shortcode from a numeric media ID or a signed CDN URL.
          const fields = payload as Record<string, unknown>;
          return [fields.url, fields.permalink].filter(
            (url): url is string => typeof url === "string" && url.length <= 8000,
          );
        });
      const candidates = [...(data.text?.match(/https:\/\/[^\s<>"']+/g) ?? []), ...attachmentUrls];
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
          diagnostics: {
            attachment_count: attachments.length,
            share_count: attachments.filter((a) => shareTypes.has(a.type)).length,
            url_count: attachmentUrls.length,
            unsupported: data.is_unsupported === true,
            outcome: links.size
              ? "link_found"
              : data.is_unsupported
                ? "unsupported"
                : attachmentUrls.length
                  ? "no_permalink"
                  : attachments.length
                    ? "attachment_without_link"
                    : "no_attachment",
          },
        },
      ];
    }),
  );
}
