import { z } from "zod";
import { reviewAction } from "./content-review";
import { modelPublishAction } from "./model-publishing";
import { reviewCommand } from "./content-review.server";
import { modelPublishing } from "./model-publishing.server";
import { verifyReviewLaunch } from "./telegram-review-auth.server";
import { pipelineOperator } from "./model-pipeline.server";

const envelope = z.object({
  initData: z.string().max(12000),
  area: z.enum(["review", "publish", "pipeline"]),
  action: z.unknown(),
});
const headers = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json",
  "Referrer-Policy": "no-referrer",
};
export async function telegramReviewRequest(request: Request) {
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers });
  const origin = process.env.CONTENT_REVIEW_ORIGIN ?? "https://instascanner.app";
  if (request.method !== "POST") return reply({}, 405);
  if (
    request.headers.get("origin") !== new URL(origin).origin ||
    !request.headers.get("content-type")?.startsWith("application/json")
  )
    return reply({}, 403);
  const reader = request.body?.getReader();
  if (!reader) return reply({}, 400);
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 32000) {
        await reader.cancel();
        return reply({}, 413);
      }
      chunks.push(part.value);
    }
    const parsed = envelope.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (!parsed.success) return reply({}, 400);
    const body = parsed.data;
    if (
      !verifyReviewLaunch(
        body.initData,
        process.env.CONTENT_REVIEW_BOT_TOKEN ?? "",
        process.env.CONTENT_REVIEW_TELEGRAM_CHAT_ID ?? "8556103033",
      )
    )
      return reply(
        {
          error:
            "Bitte das Fenster schließen und über den Button im privaten Review-Bot neu öffnen.",
        },
        401,
      );
    const owner = process.env.CONTENT_REVIEW_OWNER_ID ?? "e4ee414f-fbb6-4f82-b5fc-22d74ed6b3cc";
    if (body.area === "pipeline") {
      const action = z
        .object({ action: z.enum(["status", "pause", "enable"]) })
        .safeParse(body.action);
      if (!action.success) return reply({}, 400);
      return reply(await pipelineOperator(owner, action.data.action));
    }
    if (body.area === "publish") {
      const action = modelPublishAction.safeParse(body.action);
      if (!action.success) return reply({}, 400);
      return reply(await modelPublishing(owner, action.data));
    }
    const action = reviewAction.safeParse(body.action);
    if (!action.success || !["list", "edit", "decide", "preview"].includes(action.data.action))
      return reply({}, 400);
    return reply(await reviewCommand(owner, action.data));
  } catch {
    // Never echo launch credentials, signed URLs, provider errors or request bodies.
    return reply(
      {
        error:
          "Nicht bestätigt. Bitte aktualisieren; möglicherweise hat sich die Freigabe geändert.",
      },
      409,
    );
  }
}
