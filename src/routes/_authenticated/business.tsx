import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { businessReportFn } from "@/lib/business-report.functions";
import { Button } from "@/components/ui/button";
export const Route = createFileRoute("/_authenticated/business")({ component: Business });
function Business() {
  const { user } = Route.useRouteContext(),
    cache = useQueryClient(),
    key = ["business-report", user.id];
  const query = useQuery({
    queryKey: key,
    queryFn: () => businessReportFn({ data: { action: "status" } }),
    refetchInterval: 60000,
  });
  const action = useMutation({
    mutationFn: (action: "send" | "connect") => businessReportFn({ data: { action } }),
    onSuccess: (r) => cache.setQueryData(key, r),
  });
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 md:p-8">
      <h1 className="text-3xl font-bold">Kiikii · Zahlen & Kosten</h1>
      <p>InstaScanner aktuell. Externe Zahlen mit ihrem letzten bekannten Stand.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Button
          className="h-16 text-lg"
          onClick={() => query.refetch()}
          disabled={query.isFetching}
        >
          Zahlen aktualisieren
        </Button>
        <Button
          className="h-16 text-lg"
          onClick={() => action.mutate("send")}
          disabled={action.isPending || !query.data}
        >
          An mein Telegram
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        {query.data?.enabled
          ? "Täglich ab 20:00 Uhr · deutsche Zeit"
          : "Tagesbericht noch pausiert"}{" "}
        · Budgetwarnungen stoppen keine Jobs.
      </p>
      {(query.isError || action.isError) && (
        <p role="alert">{query.error?.message ?? action.error?.message}</p>
      )}
      {action.isSuccess && <p role="status">Bestätigt.</p>}
      {query.isPending ? (
        <p>Lädt …</p>
      ) : (
        query.data && (
          <section className="whitespace-pre-wrap rounded-2xl border p-5 leading-relaxed">
            {query.data.text}
          </section>
        )
      )}
      <details className="rounded-xl border p-4">
        <summary>Telegram: „Status Kiikii“ einrichten</summary>
        <p className="my-3">
          Einmal verbinden, danach im privaten Review-Bot „Status Kiikii“ schreiben. Ein bereits
          belegter Bot-Empfänger wird nicht überschrieben.
        </p>
        <Button
          className="h-14"
          disabled={action.isPending}
          onClick={() => action.mutate("connect")}
        >
          Status-Befehl verbinden
        </Button>
      </details>
    </main>
  );
}
