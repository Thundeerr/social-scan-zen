import { z } from "zod";
export const generationAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("link"), model: z.enum(["kiikii", "tuuva"]), url: z.string().trim().min(1).max(2048) }).strict(),
  z.object({ action: z.literal("prepare"), model: z.enum(["kiikii", "tuuva"]), id: z.string().uuid() }).strict(),
  z.object({ action: z.literal("upload"), model: z.enum(["kiikii", "tuuva"]), id: z.string().uuid() }).strict(),
]);
export type GenerationAction = z.infer<typeof generationAction>;
export type GenerationResult = {
  id: string; state?: string; enabled?: boolean; path?: string; token?: string;
};
export const MAX_SOURCE_BYTES = 40 * 1024 * 1024;
