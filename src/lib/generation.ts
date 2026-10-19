import { z } from "zod";
export const generationAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("check_link"), url: z.string().trim().min(1).max(2048) }).strict(),
  z
    .object({ action: z.literal("check_file"), sha256: z.string().regex(/^[a-f0-9]{64}$/) })
    .strict(),
  z
    .object({
      action: z.literal("link"),
      model: z.enum(["kiikii", "tuuva"]),
      url: z.string().trim().min(1).max(2048),
      duplicate_confirmed: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      action: z.literal("prepare"),
      model: z.enum(["kiikii", "tuuva"]),
      id: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal("upload"),
      model: z.enum(["kiikii", "tuuva"]),
      id: z.string().uuid(),
      duplicate_confirmed: z.boolean().default(false),
    })
    .strict(),
]);
export type GenerationAction = z.infer<typeof generationAction>;
export type GenerationResult = {
  id: string;
  state?: string;
  enabled?: boolean;
  path?: string;
  token?: string;
  duplicate_warning?: boolean;
  duplicates?: { id: string; model: "kiikii" | "tuuva"; state: string; created_at: string }[];
};
export const MAX_SOURCE_BYTES = 40 * 1024 * 1024;
