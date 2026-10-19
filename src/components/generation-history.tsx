import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { generationHistoryFn } from "@/lib/generation-history.functions";
import { contentReviewFn } from "@/lib/content-review.functions";
import {
  jobIssueLabels,
  jobStateLabels,
  type GenerationHistoryJob,
} from "@/lib/generation-history";
import { Button } from "./ui/button";

export function GenerationHistory() {
  const query = useQuery({
    queryKey: ["generation-history"],
    queryFn: () => generationHistoryFn(),
    refetchInterval: 10000,
  });
  return (
    <section className="space-y-4 border-t pt-6" aria-label="Meine Videos">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold">Meine Videos</h2>
        <Button
          type="button"
          variant="outline"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Aktualisieren
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Deine letzten 50 Aufträge · aktualisiert sich automatisch.
      </p>
      {query.isPending && <p role="status">Aufträge werden geladen …</p>}
      {query.isError && (
        <p role="alert">Aufträge konnten nicht aktualisiert werden. Bitte erneut versuchen.</p>
      )}
      {query.data?.enabled === false && (
        <p className="rounded-xl border p-3">
          Verarbeitung pausiert. Wartende Aufträge bleiben gespeichert.
        </p>
      )}
      {query.data?.jobs.length === 0 && (
        <p>Noch keine Aufträge. Dein nächster Auftrag erscheint hier.</p>
      )}
      {query.data?.jobs.map((job) => (
        <JobCard key={job.id} job={job} />
      ))}
    </section>
  );
}

function JobCard({ job }: { job: GenerationHistoryJob }) {
  const item = job.review;
  return (
    <article className="space-y-3 rounded-2xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-lg font-semibold">
          {job.model === "kiikii" ? "Kiikii" : "Tuuva"} · {item?.title || "Video-Auftrag"}
        </h3>
        <time className="text-sm text-muted-foreground" dateTime={job.created_at}>
          {new Date(job.created_at).toLocaleString("de-DE")}
        </time>
      </div>
      <p className="inline-flex rounded-full bg-secondary px-3 py-1 text-sm text-secondary-foreground">
        {jobStateLabels[job.state] ?? "Status wird geprüft"}
      </p>
      {job.issue && (
        <p role="status">{jobIssueLabels[job.issue] ?? "Der Auftrag muss geprüft werden."}</p>
      )}
      {item && item.status !== "uploading" ? (
        <ResultVideo key={`${item.id}:${item.revision}`} item={item} />
      ) : (
        job.review_id && (
          <p className="text-sm text-muted-foreground">
            Ergebnis wird übernommen oder ist noch nicht abrufbar.
          </p>
        )
      )}
      {job.review_id && (
        <Link
          to="/content-review"
          search={{ item: job.review_id }}
          className="inline-flex min-h-12 items-center underline"
        >
          Zur Prüfung
        </Link>
      )}
      <p className="text-xs text-muted-foreground">Auftrag {job.id}</p>
    </article>
  );
}

function ResultVideo({ item }: { item: NonNullable<GenerationHistoryJob["review"]> }) {
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [error, setError] = useState("");
  const preview = useQuery({
    queryKey: ["generation-result-preview", item.id, item.revision],
    queryFn: async () => {
      const result = await contentReviewFn({
        data: { action: "preview", id: item.id, revision: item.revision },
      });
      if (!result.url) throw Error("Vorschau fehlt.");
      return result.url;
    },
    staleTime: 8 * 60 * 1000,
    refetchInterval: 8 * 60 * 1000,
    retry: 1,
  });
  async function download() {
    setDownloadBusy(true);
    setError("");
    try {
      const result = await contentReviewFn({
        data: { action: "preview", id: item.id, revision: item.revision },
      });
      if (!result.url) throw Error();
      const response = await fetch(result.url, {
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      if (!response.ok) throw Error();
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `video-${item.id}-v${item.revision}.mp4`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      setError("Download fehlgeschlagen. Bitte erneut versuchen.");
    } finally {
      setDownloadBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      {preview.isPending && <p role="status">Videovorschau wird geladen …</p>}
      {preview.data && (
        <video
          key={preview.data}
          src={preview.data}
          controls
          playsInline
          preload="metadata"
          className="max-h-96 w-full rounded-xl bg-black"
          aria-label={`Ergebnis: ${item.title}`}
          onError={() => setError("Video nicht abspielbar. Bitte Vorschau neu laden.")}
        />
      )}
      {(preview.isError || error) && (
        <p role="alert">{error || "Videovorschau konnte nicht geladen werden."}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          className="min-h-12"
          disabled={downloadBusy}
          onClick={() => void download()}
        >
          {downloadBusy ? "Wird geladen …" : "Herunterladen"}
        </Button>
        {(preview.isError || error) && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setError("");
              void preview.refetch();
            }}
          >
            Vorschau neu laden
          </Button>
        )}
      </div>
    </div>
  );
}
