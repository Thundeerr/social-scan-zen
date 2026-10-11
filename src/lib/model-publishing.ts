import { z } from "zod";
const ref = { id: z.string().uuid(), revision: z.number().int().positive() };
export const modelPublishAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("queue") }),
  z.object({
    action: z.literal("schedule_preview"),
    ...ref,
    local_time: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
      .optional(),
  }),
  z.object({ action: z.literal("unschedule"), ...ref }),
  z.object({
    action: z.literal("schedule"),
    ...ref,
    confirmation: z.literal("SCHEDULE"),
    scheduled_for: z.string().datetime({ offset: true }),
    publish_mode: z.enum(["normal", "trial"]),
    ig_user_id: z.string().regex(/^[0-9]+$/),
  }),
  z.object({ action: z.literal("status"), ...ref }),
  z.object({ action: z.literal("prepare"), publish_mode: z.enum(["normal", "trial"]), ...ref }),
  z.object({ action: z.literal("cancel"), ...ref }),
  z.object({
    action: z.literal("publish"),
    ...ref,
    confirmation: z.literal("PUBLISH"),
    publish_mode: z.enum(["normal", "trial"]),
    ig_user_id: z.string().regex(/^[0-9]+$/),
  }),
]);
export type ModelPublishAction = z.infer<typeof modelPublishAction>;
export type ModelPublishStatus = {
  scheduled_for?: string | null;
  timezone?: string;
  post_id: string | null;
  status: string | null;
  publish_mode: "normal" | "trial" | null;
  username: string | null;
  ig_user_id: string | null;
  connected: boolean;
  paused: boolean;
  error: string | null;
  permalink: string | null;
};
