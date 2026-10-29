import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { catalogueOffersFn } from "@/lib/catalogue-offers.functions";
import type { OfferAction } from "@/lib/catalogue-offers";
import type { CatalogueModel } from "@/lib/content-catalogue";
import { models } from "@/lib/content-review";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CatalogueOffers({ userId }: { userId: string }) {
  const cache = useQueryClient();
  const key = ["content-catalogue", userId];
  const [page, setPage] = useState(0);
  const [title, setTitle] = useState("");
  const [model, setModel] = useState<CatalogueModel>("kiikii");
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const query = useQuery({
    queryKey: [...key, "offers", page],
    queryFn: async () => {
      const result = await catalogueOffersFn({ data: { action: "list", page } });
      if (!result) throw new Error("Could not load bundles.");
      return result;
    },
    retry: false,
    refetchInterval: 30000,
  });
  const mutation = useMutation({
    mutationFn: catalogueOffersFn,
    retry: false,
    onSuccess: (_, variables) => {
      const action = variables.data;
      if (action.action === "create") {
        setTitle("");
        setPage(0);
        setNotice("Bundle created.");
      } else if (action.action === "add") {
        setCodes((current) => ({ ...current, [action.offer_id]: "" }));
        setNotice("Clip added to bundle.");
      } else setNotice("Clip removed. Its assignment remains PPV.");
    },
    onSettled: () => cache.invalidateQueries({ queryKey: key }),
  });
  const disabled = query.isFetching || query.isError || mutation.isPending;
  function run(action: OfferAction) {
    setNotice("");
    mutation.mutate({ data: action });
  }

  return (
    <section aria-labelledby="catalogue-offers-heading" className="space-y-4">
      <h2 id="catalogue-offers-heading" className="text-2xl font-semibold">
        My bundles
      </h2>
      <p className="text-sm text-muted-foreground">
        A bundle groups multiple PPV videos. Wall videos stay separate.
      </p>
      {query.isPending && <p role="status">Loading bundles …</p>}
      {query.isError && (
        <div role="alert" className="rounded border border-destructive p-3">
          <p>{query.error.message}</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </div>
      )}
      {mutation.isError && (
        <p role="alert" className="text-destructive">
          {mutation.error.message}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <form
        className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!disabled && title.trim()) run({ action: "create", title: title.trim(), model });
        }}
      >
        <div className="space-y-2">
          <label htmlFor="offer-title">1. Name your bundle</label>
          <Input
            id="offer-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={160}
            disabled={disabled}
            placeholder="e.g. Kiikii · Set 01"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="offer-model">2. Which character?</label>
          <select
            id="offer-model"
            value={model}
            disabled={disabled}
            className="block w-full rounded border bg-background p-2"
            onChange={(e) => setModel(e.target.value as CatalogueModel)}
          >
            {Object.entries(models).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <Button
          type="submit"
          className="h-16 text-lg sm:col-span-2"
          disabled={disabled || !title.trim()}
        >
          Create bundle
        </Button>
      </form>

      {query.data && (
        <>
          {query.data.offers.length === 0 && (
            <p className="text-muted-foreground">
              {page === 0 ? "No bundles yet." : "No bundles on this page."}
            </p>
          )}
          <div className="grid gap-4">
            {query.data.offers.map((offer) => {
              const prefix = offer.model === "kiikii" ? "KII" : "TUU";
              const code = codes[offer.id] ?? "";
              const valid = new RegExp("^" + prefix + "-V[0-9]{3,}$").test(code.trim());
              return (
                <article key={offer.id} className="space-y-3 rounded-xl border bg-card p-4">
                  <header>
                    <h3 className="text-xl font-semibold">{offer.title}</h3>
                    <p className="text-sm text-muted-foreground">
                      {models[offer.model]} · {offer.clips.length} Clips
                    </p>
                  </header>
                  {offer.clips.length === 0 ? (
                    <p className="text-sm">This bundle is empty.</p>
                  ) : (
                    <ul className="divide-y">
                      {offer.clips.map((clip) => (
                        <li key={clip.id} className="flex items-center justify-between gap-3 py-2">
                          <span className="font-mono text-sm">{clip.clip_code}</span>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={disabled}
                            aria-label={"Remove " + clip.clip_code + " from " + offer.title}
                            onClick={() =>
                              run({ action: "remove", offer_id: offer.id, clip_id: clip.id })
                            }
                          >
                            Remove
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <form
                    className="space-y-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!disabled && valid)
                        run({ action: "add", offer_id: offer.id, clip_code: code.trim() });
                    }}
                  >
                    <label htmlFor={"offer-clip-" + offer.id} className="text-sm">
                      Add clip ID
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <Input
                        id={"offer-clip-" + offer.id}
                        className="max-w-xs"
                        value={code}
                        placeholder={prefix + "-V020"}
                        required
                        pattern={prefix + "-V[0-9]{3,}"}
                        disabled={disabled}
                        aria-describedby={"offer-help-" + offer.id}
                        onChange={(e) =>
                          setCodes((current) => ({ ...current, [offer.id]: e.target.value }))
                        }
                      />
                      <Button type="submit" disabled={disabled || !valid}>
                        Add
                      </Button>
                    </div>
                    <p id={"offer-help-" + offer.id} className="text-xs text-muted-foreground">
                      Enter an ID from “My videos”. The video will be assigned to PPV. Wall videos
                      cannot be added here.
                    </p>
                  </form>
                </article>
              );
            })}
          </div>
          {(query.data.total > 50 || page > 0) && (
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                disabled={disabled || page === 0}
                onClick={() => setPage(page - 1)}
              >
                Back
              </Button>
              <span className="text-sm">
                Page {page + 1} · {query.data.total} Bundles
              </span>
              <Button
                variant="outline"
                disabled={disabled || (page + 1) * 50 >= query.data.total}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
