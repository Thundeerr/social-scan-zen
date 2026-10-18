import type { models } from "./content-review";
import { z } from "zod";

export const catalogueFilterSchema = z.object({
  model: z.enum(["all", "kiikii", "tuuva"]).default("all"),
  assignment: z.enum(["all", "unassigned", "wall", "ppv"]).default("all"),
  membership: z.enum(["all", "in_offer", "no_offer"]).default("all"),
  search: z.string().trim().max(200).default(""),
  sort: z.enum(["newest", "clip_code", "assignment"]).default("newest"),
}).strict();
export type CatalogueFilters = z.infer<typeof catalogueFilterSchema>;

// Row types only; UUIDs/timestamptz are serialized as strings.
// Regenerate the Supabase Database type after deployment; this file does not
// pretend the generated client already knows about unapplied tables.
export type CatalogueModel = keyof typeof models;
export type ClipAssignment = "unassigned" | "wall" | "ppv";
export type ReceiptKind = "paid" | "free";

export interface CatalogueClip {
  id: string;
  user_id: string;
  model: CatalogueModel;
  clip_code: string;
  assignment: ClipAssignment;
  review_item_id: string | null;
  pipeline_job_id: string | null;
  created_at: string;
}

export interface CatalogueOffer {
  id: string;
  user_id: string;
  model: CatalogueModel;
  title: string;
  created_at: string;
}

export interface CatalogueOfferClip {
  offer_id: string;
  clip_id: string;
  user_id: string;
  model: CatalogueModel;
  assignment: "ppv";
}

export interface CatalogueClipRecipient {
  clip_id: string;
  user_id: string;
  model: CatalogueModel;
  recipient_key: string;
  receipt_kind: ReceiptKind;
  received_at: string | null;
  recorded_at: string;
}

export interface CatalogueRows {
  catalogue_clips: CatalogueClip;
  catalogue_offers: CatalogueOffer;
  catalogue_offer_clips: CatalogueOfferClip;
  catalogue_clip_recipients: CatalogueClipRecipient;
}

export interface CatalogueListClip extends CatalogueClip {
  offers: { id: string; title: string }[];
  review_revision: number | null;
  has_media: boolean;
  in_offer: boolean;
}

export interface CatalogueReviewCandidate {
  id: string;
  model: CatalogueModel;
  title: string;
  created_at: string;
}

export interface CatalogueSnapshot {
  clips: CatalogueListClip[];
  clip_count: number;
  reviews: CatalogueReviewCandidate[];
  review_count: number;
}
