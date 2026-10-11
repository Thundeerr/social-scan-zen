import { z } from "zod";
const ref = { id: z.string().uuid(), revision: z.number().int().positive() };
export const modelPublishAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status"), ...ref }),
  z.object({ action: z.literal("prepare"), ...ref }),
  z.object({ action: z.literal("cancel"), ...ref }),
  z.object({
    action: z.literal("publish"),
    ...ref,
    confirmation: z.literal("PUBLISH"),
    ig_user_id: z.string().regex(/^[0-9]+$/),
  }),
]);
export type ModelPublishAction = z.infer<typeof modelPublishAction>;
export type ModelPublishStatus = {
  post_id: string | null;
  status: string | null;
  username: string | null;
  ig_user_id: string | null;
  connected: boolean;
  paused: boolean;
  error: string | null;
  permalink: string | null;
};
