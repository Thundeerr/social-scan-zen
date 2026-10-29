import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { reelInboxDmFn } from "@/lib/reel-inbox-dm.functions";
import { Button } from "@/components/ui/button";
import { dmReceiptExplanation } from "@/lib/reel-inbox-dm";

export function ReelInboxDm({ userId }: { userId: string }) {
  const cache = useQueryClient();
  const [setup, setSetup] = useState<{ webhook: string; verifyToken: string }>();
  const query = useQuery({
    queryKey: ["reel-inbox-dm", userId],
    queryFn: () => reelInboxDmFn({ data: { action: "status" } }),
    refetchInterval: 15000,
  });
  const mutation = useMutation({
    mutationFn: reelInboxDmFn,
    onSuccess: (result) => {
      if (result.verifyToken && result.webhook)
        setSetup({ verifyToken: result.verifyToken, webhook: result.webhook });
      void cache.invalidateQueries({ queryKey: ["reel-inbox-dm", userId] });
    },
  });
  const status = query.data && typeof query.data.enabled === "boolean" ? query.data : null;
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="font-medium">Collect reels through Instagram DMs</h2>
      <p className="text-sm">@kiikii.bat or @thundeerr999 → send directly to @followerstarteam.</p>
      <p className="text-sm text-muted-foreground">
        No note → Kiikii. For Tuuva, add “Tuuva” when sharing, not as a separate message afterwards.
        Reels are only collected; generation does not start automatically.
      </p>
      <p role="status" className="text-sm">
        {query.isError
          ? "Could not load DM status."
          : !status
            ? "Loading DM status …"
            : !status.readyToConnect
              ? "The DM connection needs setup or renewal."
              : !status.enabled
                ? "DM collection is not enabled yet."
                : status.lastReceived
                  ? `Last accepted DM: ${new Date(status.lastReceived).toLocaleString("de-DE")}`
                  : "Collection is configured. Delivery from Meta is not confirmed yet; send a test DM."}
      </p>
      {status?.enabled && (
        <p className="text-xs text-muted-foreground">
          Verified senders:{" "}
          {status.senders.length ? status.senders.map((s) => `@${s}`).join(", ") : "none yet"}.
          Connection valid until{" "}
          {status.expiresAt ? new Date(status.expiresAt).toLocaleDateString("de-DE") : "unbekannt"}.
        </p>
      )}
      {status?.receipts?.map((r, index) => (
        <p key={index} className="text-sm">
          @{r.sender} · {new Date(r.received_at).toLocaleString("de-DE")} ·{" "}
          {r.status === "queued"
            ? `${r.link_count} reel link(s) saved${r.model ? ` · ${r.model === "tuuva" ? "Tuuva" : "Kiikii"}` : ""}`
            : `${dmReceiptExplanation(r.diagnostics)} Please send the copied reel link as text instead.`}
        </p>
      ))}
      {!!status?.collected?.length && (
        <div className="space-y-2">
          <h3 className="font-medium">Collected reels</h3>
          {status.collected.map((item, index) => {
            const reel = Array.isArray(item.reel_inbox_items)
              ? item.reel_inbox_items[0]
              : item.reel_inbox_items;
            if (!reel) return null;
            return (
              <div
                key={`${item.model}-${reel.shortcode}-${index}`}
                className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
              >
                <strong>{item.model === "tuuva" ? "Tuuva" : "Kiikii"}</strong>
                <a href={reel.canonical_url} target="_blank" rel="noreferrer" className="underline">
                  View source
                </a>
                <Button
                  variant="outline"
                  onClick={() => navigator.clipboard.writeText(reel.canonical_url)}
                >
                  Copy link
                </Button>
              </div>
            );
          })}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={!status?.readyToConnect || mutation.isPending}
          onClick={() =>
            mutation.mutate({ data: { action: status?.enabled ? "disable" : "enable" } })
          }
        >
          {status?.enabled ? "Pause DM collection" : "Enable DM collection"}
        </Button>
      </div>
      {mutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {mutation.error.message}
        </p>
      )}
      <details>
        <summary className="cursor-pointer text-sm">One-time Meta setup</summary>
        <p className="my-2 text-sm">
          In the existing Meta app, verify the webhook URL below for Instagram messages and
          subscribe to the “messages” field. Test roles or the appropriate Meta approval are
          required. Enabling this alone does not confirm delivery.
        </p>
        <Button
          variant="outline"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate({ data: { action: "setup" } })}
        >
          Show setup details
        </Button>
        {setup && (
          <div className="mt-2 space-y-2">
            <p className="break-all text-xs">{setup.webhook}</p>
            <Button variant="outline" onClick={() => navigator.clipboard.writeText(setup.webhook)}>
              Copy webhook URL
            </Button>
            <Button
              variant="outline"
              onClick={() => navigator.clipboard.writeText(setup.verifyToken)}
            >
              Copy verify token
            </Button>
            <Button variant="ghost" onClick={() => setSetup(undefined)}>
              Hide
            </Button>
          </div>
        )}
      </details>
    </section>
  );
}
