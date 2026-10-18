import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface ImportReport {
  preview: boolean;
  added: number;
  existing: number;
  skipped: number;
  issues: { item: string; reason: string; source?: string }[];
  note: string;
}

export async function importDesktopCatalogue(userId: string, input: {
  videos: string; offers: string; preview: boolean;
}): Promise<ImportReport> {
  let videos: unknown, offers: unknown;
  try {
    videos = JSON.parse(input.videos.replace(/^\uFEFF/, ""));
    offers = JSON.parse(input.offers.replace(/^\uFEFF/, ""));
  } catch { throw new Error("Bitte zwei gültige JSON-Dateien auswählen."); }
  const { data, error } = await (supabaseAdmin as SupabaseClient).rpc("import_catalogue_desktop", {
    p_user: userId, p_videos: videos, p_offers: offers, p_preview: input.preview,
  });
  if (error || !data) throw new Error(error?.message === "Catalogue owner required"
    ? "Nur der Owner darf importieren." : "Import nicht bestätigt. Dateiformat prüfen und Vorschau erneut starten.");
  return data as ImportReport;
}
