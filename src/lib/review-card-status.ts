import { models, reviewCard, type ReviewItem } from "./content-review";
type Post = { status: string | null; scheduled_for: string | null; publish_mode: string | null };
export function reviewStatusCard(item: ReviewItem, post: Post, origin: string, chat: string) {
  const card = reviewCard(item, origin, chat);
  const date = post.scheduled_for
    ? new Intl.DateTimeFormat("de-DE", {
        timeZone: "Europe/Berlin",
        dateStyle: "full",
        timeStyle: "short",
      }).format(new Date(post.scheduled_for))
    : null;
  const mode = post.publish_mode === "trial" ? "Trial Reel" : "Normales Reel";
  let state = "📝 Noch nicht zum Posten eingeplant.";
  if (post.status === "scheduled")
    state = `🗓 Geplant für ${date} Uhr\nZeitzone: Deutschland (Europe/Berlin)\n${mode} · wird automatisch veröffentlicht.`;
  else if (post.status === "publishing") state = `⏳ Wird gerade veröffentlicht · ${mode}`;
  else if (post.status === "published") state = `✅ Veröffentlicht · ${mode}`;
  else if (post.status === "failed")
    state = "⚠️ Veröffentlichung gestoppt. Bitte in der Freigabeansicht prüfen.";
  else if (item.status === "rejected") state = "❌ Abgelehnt · nicht eingeplant.";
  else if (item.status === "changes") state = "✏️ Änderungen gewünscht · nicht eingeplant.";
  else if (item.status === "approved")
    state = "✅ Inhalt freigegeben · noch kein Posting-Termin bestätigt.";
  return {
    ...card,
    caption: `${models[item.model]} · Reel · Version ${item.revision}\n${item.title}\n\n${state}\n\nÜber den Button Video, Caption und Termin prüfen.`,
  };
}
