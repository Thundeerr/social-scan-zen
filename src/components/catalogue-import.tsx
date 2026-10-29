import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { catalogueImportFn } from "@/lib/catalogue-import.functions";
import { Button } from "@/components/ui/button";

export function CatalogueImport({ userId }: { userId: string }) {
  const cache = useQueryClient();
  const [videos, setVideos] = useState("");
  const [offers, setOffers] = useState("");
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const mutation = useMutation({
    mutationFn: catalogueImportFn,
    onSuccess: (report) => {
      if (!report.preview)
        void cache.invalidateQueries({ queryKey: ["content-catalogue", userId] });
    },
  });
  const busy = reading || mutation.isPending;
  async function read(file: File | undefined, kind: "videos" | "offers") {
    mutation.reset();
    setError("");
    setReading(true);
    const set = kind === "videos" ? setVideos : setOffers;
    set("");
    try {
      if (!file) return;
      if (file.size > 1000000) throw new Error("The file must be no larger than 1 MB.");
      set(await file.text());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the file.");
    } finally {
      setReading(false);
    }
  }
  return (
    <details className="rounded-xl border p-4">
      <summary className="cursor-pointer py-3 font-semibold">Import desktop files</summary>
      <div className="mt-3 space-y-4">
        <p>Check first, then import. Existing videos are not overwritten. Nothing is published.</p>
        <label className="grid gap-2">
          1. VIDEO REGISTER.json
          <input
            type="file"
            accept=".json,application/json"
            disabled={busy}
            onChange={(e) => void read(e.target.files?.[0], "videos")}
          />
        </label>
        <label className="grid gap-2">
          2. OFFER REGISTER.json
          <input
            type="file"
            accept=".json,application/json"
            disabled={busy}
            onChange={(e) => void read(e.target.files?.[0], "offers")}
          />
        </label>
        <Button
          className="h-14 w-full text-lg"
          disabled={busy || !videos || !offers}
          onClick={() => mutation.mutate({ data: { videos, offers, preview: true } })}
        >
          {mutation.isPending ? "Checking …" : "Check files without saving"}
        </Button>
        {(error || mutation.isError) && <p role="alert">{error || mutation.error?.message}</p>}
        {mutation.data && (
          <div role="status" className="space-y-3 rounded-lg bg-muted p-4">
            <p className="font-semibold">
              {mutation.data.preview ? "Preview — nothing saved yet" : "Import complete"}
            </p>
            <p>
              {mutation.data.added} {mutation.data.preview ? "new" : "saved"} records ·{" "}
              {mutation.data.existing} already present · {mutation.data.skipped} skipped
            </p>
            <p className="text-sm">
              Counts include videos, bundles, bundle memberships and recipients. Historical handles
              are not verified fan IDs.
            </p>
            {mutation.data.issues.length > 0 && (
              <details>
                <summary className="cursor-pointer py-3">
                  View notes ({mutation.data.issues.length})
                </summary>
                <ul className="space-y-2">
                  {mutation.data.issues.map((issue, i) => (
                    <li key={i}>
                      {issue.item}: {issue.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                const url = URL.createObjectURL(
                  new Blob([JSON.stringify(mutation.data, null, 2)], { type: "application/json" }),
                );
                const a = document.createElement("a");
                a.href = url;
                a.download = "catalogue-import-report.json";
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
            >
              Download report
            </Button>
            {mutation.data.preview && (
              <Button
                className="h-14 w-full text-lg"
                disabled={busy}
                onClick={() => mutation.mutate({ data: { videos, offers, preview: false } })}
              >
                Import now — skip conflicts
              </Button>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
