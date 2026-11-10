import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { kiikiiCommentCampaignFn } from "@/lib/kiikii-comment-campaigns.functions";
import { Button } from "@/components/ui/button";

export function KiikiiCommentCampaign({ userId }: { userId: string }) {
  const cache = useQueryClient(), key = ["kiikii-comment-campaign", userId];
  const [fields, setFields] = useState<string[] | null>(null);
  const query = useQuery({ queryKey: key, queryFn: () => kiikiiCommentCampaignFn({ data: { action: "status" } }), refetchInterval: 15000 });
  const change = useMutation({ mutationFn: kiikiiCommentCampaignFn, onSuccess: (data) => {
    if (data.accountSubscribedFields) setFields(data.accountSubscribedFields);
    cache.setQueryData(key, data);
  } });
  const s = query.data, campaign = s?.campaign;
  if (!query.isError && !campaign) return null;
  return <section id="kiikii-comment-campaign" className="space-y-3 rounded-xl border bg-card p-4">
    <h2 className="font-medium">Kiikii · Outfit-Reel: Kommentar → Gespräch</h2>
    <p className="text-sm">Nur unter <a className="underline" href={s?.permalink} target="_blank" rel="noreferrer">diesem Reel</a>: Ein Kommentar mit genau {"<3"} erhält einmal pro Person eine private Intro-DM. Nach ihrer Antwort übernimmt Cupid.</p>
    {campaign && <p className="rounded border p-2 text-sm">{campaign.reply}</p>}
    <p role="status" className="text-sm">{query.isError ? "Status konnte nicht geladen werden." : campaign?.enabled ? "Aktiv für neue passende Kommentare." : "Diese Reel-Automatik ist pausiert."}</p>
    <div className="flex flex-wrap gap-2">
      <Button disabled={!s?.ready || change.isPending || campaign?.enabled} onClick={() => change.mutate({ data: { action: "enable" } })}>Für dieses Reel aktivieren</Button>
      <Button variant="outline" disabled={change.isPending || !campaign?.enabled} onClick={() => change.mutate({ data: { action: "pause" } })}>Pausieren</Button>
      <Button variant="outline" disabled={!s?.ready || change.isPending} onClick={() => change.mutate({ data: { action: "check" } })}>Verbindung prüfen</Button>
      <Button variant="outline" disabled={!s?.ready || !campaign?.enabled || change.isPending || campaign?.backfillComplete} onClick={() => change.mutate({ data: { action: "catchup" } })}>{campaign?.backfillHasMore ? "Weitere Kommentare prüfen" : "Vorhandene Kommentare prüfen"}</Button>
    </div>
    <p className="text-xs text-muted-foreground">{campaign?.backfillComplete ? "Vorhandene Kommentare wurden vollständig geprüft." : "Vorhandene Kommentare werden in kleinen Gruppen nachgeholt. Neue Kommentare werden auch bei ausgeschaltetem PC automatisch verarbeitet."}</p>
    <p className="text-xs text-muted-foreground">Letzter Kommentar-Eingang: {campaign?.lastWebhookAt ? new Date(campaign.lastWebhookAt).toLocaleString("de-DE") : "noch keiner bestätigt"}. Letzte angenommene Intro-DM: {campaign?.lastDeliveryAt ? new Date(campaign.lastDeliveryAt).toLocaleString("de-DE") : "noch keine über diese Automatik"}.</p>
    <p className="text-xs text-muted-foreground">Letzte automatische Prüfung: {campaign?.lastPollCompletedAt ? new Date(campaign.lastPollCompletedAt).toLocaleString("de-DE") : "noch nicht bestätigt"}{campaign?.lastPollError ? " · Bei der letzten Prüfung ist ein Fehler aufgetreten." : ""}.</p>
    {fields && <details className="text-xs"><summary>Verbindungsdetails</summary><p>Account-Abonnements: {fields.join(", ")}. Das App-Abonnement wird separat in Meta geprüft; ein neuer Kommentar-Eingang bestätigt die Zustellung.</p></details>}
    {!s?.ready && <p className="text-sm">Der alte DM-Responder muss pausiert und die Kiikii-Verbindung gültig sein.</p>}
    {(change.error || campaign?.lastError) && <p role="alert" className="text-sm text-destructive">{change.error?.message ?? `Letzter Fehler: ${campaign?.lastError}`}</p>}
    {!!s?.receipts.length && <ul className="space-y-1 text-xs text-muted-foreground">{s.receipts.map((r, i) => <li key={i}>{new Date(r.received_at).toLocaleString("de-DE")} · {r.status === "sent" ? "Meta hat die Intro-DM angenommen." : r.status === "reserved" || r.status === "uncertain" ? "Zustellung unbestätigt; kein automatischer Wiederholungsversuch." : `${r.status}${r.error_code ? ` (${r.error_code})` : ""}`}</li>)}</ul>}
  </section>;
}
