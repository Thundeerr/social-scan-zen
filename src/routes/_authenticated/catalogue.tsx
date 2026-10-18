import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  catalogueListFn, promoteReviewItemToClipFn, setClipAssignmentFn,
} from "@/lib/content-catalogue.functions";
import { models } from "@/lib/content-review";
import { contentReviewFn } from "@/lib/content-review.functions";
import { catalogueFilterSchema, type CatalogueFilters, type ClipAssignment } from "@/lib/content-catalogue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CatalogueOffers } from "@/components/catalogue-offers";
import { CatalogueImport } from "@/components/catalogue-import";

export const Route = createFileRoute("/_authenticated/catalogue")({
  component: ContentCatalogue,
});

const assignments: Record<ClipAssignment, string> = {
  unassigned: "Noch offen",
  wall: "Wall",
  ppv: "PPV",
};

function ReviewPreview({ id, revision }: { id: string; revision: number }) {
  const [url, setUrl] = useState("");
  const preview = useMutation({
    mutationFn: () => contentReviewFn({ data: { action: "preview", id, revision } }),
    onSuccess: (result) => { if (result.url) setUrl(result.url); },
  });
  return (
    <div className="space-y-2">
      <Button variant="outline" className="h-14 w-full text-base" disabled={preview.isPending}
        onClick={() => { setUrl(""); preview.mutate(); }}>
        {preview.isPending ? "Lädt …" : url ? "Vorschau erneuern" : "Video ansehen"}
      </Button>
      {url && <video className="max-h-96 w-full rounded-xl" src={url} controls preload="metadata"
        onError={() => setUrl("")} />}
      {preview.isError && <p role="alert" className="text-xs text-destructive">{preview.error.message}</p>}
    </div>
  );
}

function Pager({ page, count, disabled, onChange }: {
  page: number; count: number; disabled: boolean; onChange: (page: number) => void;
}) {
  if (count <= 50 && page === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="outline" disabled={disabled || page === 0} onClick={() => onChange(page - 1)}>
        Zurück
      </Button>
      <span className="text-sm">Seite {page + 1} · {count} Einträge</span>
      <Button variant="outline" disabled={disabled || (page + 1) * 50 >= count} onClick={() => onChange(page + 1)}>
        Weiter
      </Button>
    </div>
  );
}

function ContentCatalogue() {
  const { user } = Route.useRouteContext();
  const cache = useQueryClient();
  const [clipPage, setClipPage] = useState(0);
  const [reviewPage, setReviewPage] = useState(0);
  const [view, setView] = useState<"videos" | "add" | "bundles">("videos");
  const [reviewId, setReviewId] = useState("");
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [filters, setFilters] = useState<CatalogueFilters>(() => catalogueFilterSchema.parse({}));
  const [searchInput, setSearchInput] = useState("");
  const updateFilters = (patch: Partial<CatalogueFilters>) => {
    setFilters((previous) => ({ ...previous, ...patch }));
    setClipPage(0);
  };
  const filtered = filters.model !== "all" || filters.assignment !== "all"
    || filters.membership !== "all" || !!filters.search;
  const key = ["content-catalogue", user.id];
  const query = useQuery({
    queryKey: [...key, clipPage, reviewPage, filters],
    queryFn: () => catalogueListFn({ data: { clip_page: clipPage, review_page: reviewPage, filters } }),
    placeholderData: keepPreviousData,
    refetchInterval: 30000,
    retry: false,
  });
  const refresh = () => cache.invalidateQueries({ queryKey: key });
  const changed = useMutation({
    mutationFn: setClipAssignmentFn,
    onSuccess: () => setNotice("Zuordnung gespeichert."),
    onError: (error) => setActionError(error.message),
    onSettled: refresh,
  });
  const promoted = useMutation({
    mutationFn: promoteReviewItemToClipFn,
    onSuccess: (clip) => {
      setNotice(clip.clip_code + " ist im Katalog.");
      setCode("");
      setReviewId("");
      setClipPage(0);
      setFilters(catalogueFilterSchema.parse({}));
      setSearchInput("");
      setView("videos");
    },
    onError: (error) => setActionError(error.message),
    onSettled: async () => {
      await refresh();
      await cache.invalidateQueries({ queryKey: ["content-review", user.id] });
    },
  });
  const busy = changed.isPending || promoted.isPending;
  const disabled = busy || query.isFetching || query.isError;
  const selected = query.data?.reviews.find((item) => item.id === reviewId);
  const prefix = selected?.model === "tuuva" ? "TUU" : "KII";
  const validCode = !!selected && new RegExp("^" + prefix + "-V[0-9]{3,}$").test(code.trim());
  const clearMessages = () => { setNotice(""); setActionError(""); };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6 [&_button]:min-h-12 [&_input]:min-h-12 [&_select]:min-h-12">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Deine Videos</h1>
          <p className="mt-2 text-muted-foreground">
            Videos sammeln. Wall oder PPV wählen. Bundles zusammenstellen.
            Hier wird nichts veröffentlicht.
          </p>
        </div>
        <Button variant="outline" disabled={busy || query.isFetching} onClick={() => void refresh()}>
          Aktualisieren
        </Button>
      </header>

      <nav aria-label="Videobibliothek" className="grid grid-cols-2 gap-3">
        <Button className="h-16 text-lg" variant={view !== "bundles" ? "default" : "outline"}
          aria-pressed={view !== "bundles"} onClick={() => setView("videos")}>Meine Videos</Button>
        <Button className="h-16 text-lg" variant={view === "bundles" ? "default" : "outline"}
          aria-pressed={view === "bundles"} onClick={() => setView("bundles")}>Meine Bundles</Button>
      </nav>
      {view === "videos" && <Button className="h-16 w-full text-lg" onClick={() => setView("add")}>
        + Video hinzufügen
      </Button>}
      {view === "videos" && <details className="rounded-xl border p-4">
        <summary className="cursor-pointer py-3 text-base font-semibold">Suchen &amp; filtern{filtered ? " · Filter aktiv" : ""}</summary>
      <section aria-label="Bibliothek filtern" className="space-y-3 rounded-xl border p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="grid gap-1 text-sm">Charakter
            <select className="rounded border bg-background p-2" value={filters.model} disabled={busy}
              onChange={(event) => updateFilters({ model: event.target.value as CatalogueFilters["model"] })}>
              <option value="all">Alle Charaktere</option><option value="kiikii">Kiikii</option><option value="tuuva">Tuuva</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">Zuordnung
            <select className="rounded border bg-background p-2" value={filters.assignment} disabled={busy}
              onChange={(event) => updateFilters({ assignment: event.target.value as CatalogueFilters["assignment"] })}>
              <option value="all">Alle Zuordnungen</option>
              {Object.entries(assignments).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm">Bundle
            <select className="rounded border bg-background p-2" value={filters.membership} disabled={busy}
              onChange={(event) => updateFilters({ membership: event.target.value as CatalogueFilters["membership"] })}>
              <option value="all">Alle Clips</option><option value="in_offer">In einem Bundle</option><option value="no_offer">In keinem Bundle</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">Sortierung
            <select className="rounded border bg-background p-2" value={filters.sort} disabled={busy}
              onChange={(event) => updateFilters({ sort: event.target.value as CatalogueFilters["sort"] })}>
              <option value="newest">Neueste zuerst</option><option value="clip_code">Clip-ID aufsteigend</option>
              <option value="assignment">Noch offen → Wall → PPV</option>
            </select>
          </label>
        </div>
        <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
          event.preventDefault(); updateFilters({ search: searchInput.trim() });
        }}>
          <label className="grid flex-1 gap-1 text-sm" htmlFor="catalogue-search">Clip-ID suchen
            <Input id="catalogue-search" value={searchInput} maxLength={200} placeholder="z. B. KII-V020"
              disabled={busy} onChange={(event) => setSearchInput(event.target.value)} />
          </label>
          <Button type="submit" disabled={busy}>Suchen</Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => {
            setFilters(catalogueFilterSchema.parse({})); setSearchInput(""); setClipPage(0);
          }}>Zurücksetzen</Button>
        </form>
        <p className="text-xs text-muted-foreground">Filter gelten für die Bibliothek auf allen Seiten. Offers und freigegebene Reviews bleiben ungefiltert.</p>
        {query.isFetching && !query.isPending && <p role="status" className="text-sm">Bibliothek wird aktualisiert …</p>}
      </section></details>}

      {query.isPending && <p role="status">Katalog wird geladen …</p>}
      {query.isError && (
        <div role="alert" className="rounded-xl border border-destructive p-4">
          <p>{query.error.message}</p>
          <Button className="mt-2" variant="outline" onClick={() => void query.refetch()}>
            Erneut versuchen
          </Button>
        </div>
      )}
      {notice && <p role="status" className="rounded-lg border p-3">{notice}</p>}
      {actionError && <p role="alert" className="rounded-lg border border-destructive p-3">{actionError}</p>}

      {query.data && view !== "bundles" && (
        <>
          {view === "videos" && <section aria-labelledby="catalogue-clips-heading" className="space-y-4">
            <h2 id="catalogue-clips-heading" className="text-lg font-semibold">
              Meine Videos ({query.data.clip_count}{filtered ? " Treffer" : ""})
            </h2>
            {query.data.clips.length === 0 ? (
              <p className="text-muted-foreground">
                {filtered ? "Keine Clips für diese Filter gefunden." : clipPage === 0 ? "Hier ist noch Platz für deine Videos. Klicke oben auf „+ Video hinzufügen“." : "Keine Clips auf dieser Seite."}
              </p>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {query.data.clips.map((clip) => <article key={clip.id} className="space-y-4 rounded-2xl border bg-card p-5">
                  <header className="flex flex-wrap items-center justify-between gap-2">
                    <div><h3 className="text-xl font-semibold">{clip.clip_code}</h3>
                      <p className="text-muted-foreground">{models[clip.model]}</p></div>
                    <Badge variant="outline" className="px-3 py-2 text-sm">{assignments[clip.assignment]}</Badge>
                  </header>
                  {clip.has_media && clip.review_item_id && clip.review_revision ?
                    <ReviewPreview key={clip.review_item_id + ":" + clip.review_revision}
                      id={clip.review_item_id} revision={clip.review_revision} /> :
                    <p className="rounded-xl bg-muted p-4 text-muted-foreground">Keine Videovorschau verknüpft.</p>}
                  <fieldset disabled={disabled || clip.in_offer} className="space-y-2">
                    <legend className="mb-2 font-medium">Wofür ist dieses Video?</legend>
                    <div className="grid grid-cols-3 gap-2">
                      {Object.entries(assignments).map(([value,label]) => <Button key={value}
                        className="h-14 text-base" aria-pressed={clip.assignment === value}
                        variant={clip.assignment === value ? "default" : "outline"}
                        disabled={disabled || clip.in_offer || clip.assignment === value}
                        onClick={() => { clearMessages(); changed.mutate({data: {
                          clip_id: clip.id, assignment: value as ClipAssignment, expected_assignment: clip.assignment,
                        }}); }}>{label}</Button>)}
                    </div>
                  </fieldset>
                  {clip.in_offer && <p className="text-sm text-muted-foreground">Zum Ändern zuerst aus den Bundles entfernen.</p>}
                  {clip.offers.length > 0 && <div><p className="font-medium">In diesen Bundles:</p>
                    <ul>{clip.offers.map(offer => <li key={offer.id}>{offer.title}</li>)}</ul></div>}
                  <details className="text-sm text-muted-foreground"><summary className="cursor-pointer py-2">Videodetails</summary>
                    Hinzugefügt: <time dateTime={clip.created_at}>{new Date(clip.created_at).toLocaleString("de-DE")}</time>
                  </details>
                </article>)}
              </div>
            )}
            <Pager page={clipPage} count={query.data.clip_count} disabled={disabled} onChange={setClipPage} />
          </section>}

          {view === "add" && <section aria-labelledby="catalogue-promote-heading" className="space-y-4 rounded-xl border bg-card p-4">
            <h2 id="catalogue-promote-heading" className="text-2xl font-semibold">Video hinzufügen</h2>
            <p className="text-sm text-muted-foreground">
              Wähle ein freigegebenes Video und gib ihm eine feste Nummer.
            </p>
            {query.data.reviews.length === 0 ? (
              <p>{reviewPage === 0 ? "Keine freigegebenen Reviews ohne Clip vorhanden." : "Keine Reviews auf dieser Seite."}</p>
            ) : (
              <form className="grid gap-3" onSubmit={(event) => {
                event.preventDefault();
                if (disabled || !validCode || !selected) return;
                clearMessages();
                promoted.mutate({ data: { review_item_id: selected.id, clip_code: code.trim() } });
              }}>
                <label htmlFor="catalogue-review" className="text-lg font-semibold">1. Video auswählen</label>
                <select id="catalogue-review" className="w-full rounded border bg-background p-2"
                  value={selected?.id ?? ""} disabled={disabled}
                  onChange={(event) => { setReviewId(event.target.value); setCode(""); clearMessages(); }}>
                  <option value="">Video auswählen …</option>
                  {query.data.reviews.map((item) => (
                    <option key={item.id} value={item.id}>{models[item.model]} · {item.title}</option>
                  ))}
                </select>
                {selected && <Link className="text-sm underline" to="/content-review" search={{ item: selected.id }}>
                  Video vor dem Hinzufügen prüfen ↗
                </Link>}
                <label htmlFor="catalogue-code" className="text-lg font-semibold">2. Video-Nummer eingeben</label>
                <Input id="catalogue-code" value={code} placeholder={prefix + "-V020"}
                  disabled={disabled || !selected} required pattern={prefix + "-V[0-9]{3,}"} autoComplete="off"
                  aria-describedby="catalogue-code-help" onChange={(event) => setCode(event.target.value)} />
                <p id="catalogue-code-help" className="text-xs text-muted-foreground">
                  Zum Beispiel {prefix}-V020. Jede Nummer darf nur einmal vergeben werden und bleibt fest.
                </p>
                <Button className="h-16 w-full text-lg" type="submit" disabled={disabled || !validCode}>
                  {promoted.isPending ? "Wird übernommen …" : "Video speichern"}
                </Button>
              </form>
            )}
            <Pager page={reviewPage} count={query.data.review_count} disabled={disabled} onChange={(page) => {
              setReviewPage(page); setReviewId(""); setCode("");
            }} />
            <Button variant="outline" className="w-full" disabled={busy} onClick={() => setView("videos")}>Zurück zu meinen Videos</Button>
          </section>}
        </>
      )}
      {view === "bundles" && <CatalogueOffers userId={user.id} />}
      <CatalogueImport userId={user.id} />
    </div>
  );
}
