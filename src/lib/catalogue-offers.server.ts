import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { OfferAction, OfferSnapshot } from "./catalogue-offers";

const messages: Record<string, string> = {
  "Catalogue owner required": "Owner-Zugriff erforderlich.",
  "Clip not found": "Clip-ID nicht gefunden.",
  "Offer not found": "Offer nicht gefunden. Bitte aktualisieren.",
  "Clip and offer characters differ": "Clip und Offer müssen zum gleichen Charakter gehören.",
  "Wall clips cannot enter offers": "Wall-Clips dürfen nicht in Offers aufgenommen werden.",
  "Invalid offer title or character": "Bitte Titel und Charakter prüfen.",
};

export async function catalogueOfferCommand(userId: string, action: OfferAction): Promise<OfferSnapshot | null> {
  const { data, error } = await (supabaseAdmin as SupabaseClient).rpc("catalogue_offer_command", {
    p_user: userId, p_action: action.action, p_data: action,
  });
  if (error) throw new Error(messages[error.message] ?? "Offer-Aktion nicht bestätigt. Bitte aktualisieren.");
  if (action.action === "list") {
    if (!data) throw new Error("Offers konnten nicht geladen werden.");
    return data as OfferSnapshot;
  }
  return null;
}
