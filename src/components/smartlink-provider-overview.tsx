import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { smartlinkFn } from "@/lib/smartlinks.functions";
import { PROVIDERS, type ProviderStats } from "@/lib/smartlink-providers";
import type { SmartlinkAction } from "@/lib/smartlinks";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
type Filter = Extract<SmartlinkAction, {action:"analytics"}>["filter"];
export function ProviderOverview({ filter, connections }: {filter:Filter; connections:{id:string; configured:boolean}[]}) {
  const fn = useServerFn(smartlinkFn), cache = useQueryClient();
  const alive = useRef(true), running = useRef(false);
  const [active, setActive] = useState("");
  useEffect(() => { alive.current = true; return () => {alive.current = false; running.current = false;}; }, []);
  const stats = useQuery({queryKey:["smartlinks","providers",filter], queryFn:async()=>await fn({data:{action:"provider_stats",filter}}) as ProviderStats, enabled: (!filter.country || filter.country.length === 2) && (!filter.link || /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(filter.link)), refetchInterval:30000});
  async function process(provider:"bitly"|"tinyurl") {
    if (running.current) return;
    running.current = true; setActive(provider);
    try {
      while (alive.current && running.current) {
        const result = await fn({data:{action:"process_provider",provider}}) as {state:string};
        if (!alive.current) break;
        await cache.invalidateQueries({queryKey:["smartlinks"]});
        if (result.state !== "ready") {
          toast.info(result.state === "throttled" ? "Lokales Versandbudget erreicht. In einer Minute fortsetzen." : "Verarbeitung beendet oder angehalten. Provider-Status prüfen.");
          break;
        }
        await new Promise(resolve=>setTimeout(resolve,3100));
      }
    } catch(e) { if(alive.current) toast.error(e instanceof Error ? e.message : "Provider-Anfrage fehlgeschlagen."); }
    finally {running.current=false; if(alive.current) setActive("");}
  }
  const total = stats.data?.providers.reduce((n,p)=>n+Number(p.clicks),0) ?? 0;
  return <section className="rounded-xl border border-border bg-card p-5 space-y-5" aria-label="Provider Overview">
    <div className="flex flex-wrap justify-between gap-3"><div><h2 className="font-semibold">Performance & Provider</h2><p className="text-xs text-muted-foreground mt-1">Klicks im ausgewählten Zeitraum · Erstellungsstatus aller zugeordneten Links</p></div><div className="text-right"><strong className="text-2xl">{total.toLocaleString("de-DE")}</strong><span className="ml-2 text-xs text-muted-foreground">Klicks</span></div></div>
    {stats.isPending && <p role="status">Performance wird geladen …</p>}
    {stats.isError && <p role="alert">Provider-Übersicht nicht verfügbar. <Button variant="outline" onClick={()=>void stats.refetch()}>Erneut laden</Button></p>}
    <div className="grid gap-3 lg:grid-cols-3">{PROVIDERS.map(provider=>{
      const row=stats.data?.providers.find(p=>p.provider===provider.id);
      const connected=connections.find(p=>p.id===provider.id)?.configured;
      const issue=Boolean(row && (row.failed || row.uncertain));
      return <article key={provider.id} className="rounded-lg border border-border bg-background/50 p-4 space-y-3">
        <div className="flex justify-between gap-2"><h3 className="font-medium">{provider.name}</h3><span className={issue ? "text-amber-400 text-xs" : "text-muted-foreground text-xs"}>{!connected ? "Nicht verbunden" : issue ? "Prüfung nötig" : "Zugang konfiguriert"}</span></div>
        <div className="grid grid-cols-2 gap-3 text-sm"><div><strong>{row?.clicks ?? 0}</strong> Klicks</div><div><strong>{row?.human ?? 0}</strong> Human ≈</div><div>{row?.ready ?? 0} bereit</div><div>{row?.pending ?? 0} offen</div></div>
        <p className="text-xs text-muted-foreground">{row?.failed ?? 0} Fehler · {row?.uncertain ?? 0} unbestätigt</p>
        {row?.last_error && <p className="text-xs text-amber-400 break-all">Letzter Fehler: {row.last_error}. Provider-Konto und Kontingent prüfen.</p>}
        {!connected && <p className="text-xs text-muted-foreground">{provider.id==="bitly" ? "Server-Secrets: BITLY_ACCESS_TOKEN + BITLY_GROUP_GUID" : "Server-Secret: TINYURL_API_TOKEN"}</p>}
        {provider.id!=="instascanner" && connected && Boolean(row?.failed) && <Button size="sm" variant="outline" disabled={Boolean(active)} onClick={async()=>{try { await fn({data:{action:"retry_provider",provider:provider.id as "bitly"|"tinyurl"}}); await cache.invalidateQueries({queryKey:["smartlinks"]}); } catch(e) {toast.error(e instanceof Error ? e.message : "Freigabe fehlgeschlagen.");}}}>Nach Korrektur erneut freigeben</Button>}
        {provider.id!=="instascanner" && connected && !issue && <Button size="sm" variant="outline" disabled={Boolean(active)} onClick={()=>void process(provider.id as "bitly"|"tinyurl")}>{active===provider.id ? "Wird verarbeitet …" : "Offene Aufträge fortsetzen"}</Button>}
      </article>;
    })}</div>
    {active && <Button variant="outline" onClick={()=>{running.current=false;}}>Nach aktuellem Link pausieren</Button>}
    <p className="text-xs text-muted-foreground">Die Verarbeitung läuft bei geöffneter Seite; offene Aufträge bleiben gespeichert. Fortsetzen verarbeitet alle offenen Aufträge dieses Providers. API-Fehler stoppen den Provider. Ein konfigurierter Zugang ist noch kein Erreichbarkeitsnachweis.</p>
    <div className="border-t border-border pt-4"><h3 className="font-medium mb-3">Top-Links nach Klicks</h3>
      {!stats.data?.top.length ? <p className="text-sm text-muted-foreground">Noch keine Klicks für diese Auswahl.</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-muted-foreground text-left"><th className="p-2">Provider / Link</th><th className="p-2 text-right">Klicks</th><th className="p-2 text-right">Human ≈</th></tr></thead><tbody>{stats.data.top.map(row=><tr key={row.id} className="border-t border-border"><td className="p-2"><span className="text-xs text-primary">{PROVIDERS.find(p=>p.id===row.provider)?.name}</span><p className="max-w-xl break-all text-xs">{row.url}</p></td><td className="p-2 text-right">{row.clicks}</td><td className="p-2 text-right">{row.human}</td></tr>)}</tbody></table></div>}
    </div>
    <p className="text-xs text-muted-foreground">Leads & Umsatz: noch nicht angeschlossen. Klicks allein belegen keinen Verkauf. Provider-Fehler beziehen sich auf API-Aufträge, nicht auf eine laufende Verfügbarkeitsmessung.</p>
  </section>;
}

