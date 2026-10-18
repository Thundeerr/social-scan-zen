import { z } from "zod";
import type { CatalogueOffer } from "./content-catalogue";

export const offerAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), page: z.number().int().min(0).max(100000).default(0) }).strict(),
  z.object({
    action: z.literal("create"), title: z.string().trim().min(1).max(160),
    model: z.enum(["kiikii", "tuuva"]),
  }).strict(),
  z.object({
    action: z.literal("add"), offer_id: z.string().uuid(),
    clip_code: z.string().trim().regex(/^(KII|TUU)-V[0-9]{3,}$/),
  }).strict(),
  z.object({
    action: z.literal("remove"), offer_id: z.string().uuid(), clip_id: z.string().uuid(),
  }).strict(),
]);
export type OfferAction = z.infer<typeof offerAction>;
export interface OfferListItem extends CatalogueOffer {
  clips: { id: string; clip_code: string }[];
}
export interface OfferSnapshot { offers: OfferListItem[]; total: number }
