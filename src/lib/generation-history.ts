export type GenerationHistoryJob = {
  id: string;
  model: "kiikii" | "tuuva";
  state: string;
  issue: string | null;
  created_at: string;
  review_id: string | null;
  review: { id: string; title: string; revision: number; status: string } | null;
};

export const jobStateLabels: Record<string, string> = {
  queued: "Wartet auf Verarbeitung",
  working: "Quelle wird vorbereitet",
  budget_wait: "Wartet auf Tagesbudget",
  reserved: "Generierung wird vorbereitet",
  generating: "Video wird erstellt",
  review: "Video erstellt",
  blocked: "Auftrag braucht Aufmerksamkeit",
};

export const jobIssueLabels: Record<string, string> = {
  source_unavailable: "Die Quelle konnte nicht geladen werden.",
  duration: "Die Videolänge passt nicht zu den erlaubten Grenzen.",
  validation: "Eine Datei konnte nicht geprüft werden.",
  provider_uncertain: "Die Bestätigung des Anbieters fehlt. Bitte nicht erneut absenden.",
  provider_failed: "Der Anbieter konnte das Video nicht erstellen.",
  setup: "Die Server-Konfiguration muss geprüft werden.",
};
