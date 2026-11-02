import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { kiikiiDmRedirectFn } from "@/lib/kiikii-dm-redirect.functions";
import { startInstagramOAuthFn } from "@/lib/instagram-oauth.functions";
import { DM_LINK, DM_REPLIES } from "@/lib/kiikii-dm-redirect";
import { Button } from "@/components/ui/button";

export function KiikiiDmRedirect({ userId }: { userId: string }) {
  const cache = useQueryClient();
  const key = ["kiikii-dm-redirect", userId];
  const query = useQuery({
    queryKey: key,
    queryFn: () => kiikiiDmRedirectFn({ data: { action: "status" } }),
    refetchInterval: 15000,
  });
  const change = useMutation({
    mutationFn: kiikiiDmRedirectFn,
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: key });
    },
  });
  const connect = useMutation({
    mutationFn: () => startInstagramOAuthFn({ data: { destination: "kiikii", messaging: true } }),
    onSuccess: (r) => {
      window.location.href = r.authorizeUrl;
    },
  });
  const s = query.data;
  const status = !s
    ? "Loading…"
    : !s.ready
      ? "Kiikii needs messaging permission."
      : s.mode === "live"
        ? "Enabled for new incoming DMs."
        : s.mode === "test"
          ? "Test mode: only @user_diary01 receives a reply."
          : "Paused. No automatic replies are being sent.";
  return (
    <section id="kiikii-dm-redirect" className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="font-medium">Kiikii · Send visitors to the website chat</h2>
      <p className="text-sm">
        One of 30 short replies tells visitors there is no chat in IG DMs and links to{" "}
        <a className="underline" href={DM_LINK} target="_blank" rel="noreferrer">
          chat.kiiki.info
        </a>
        .
      </p>
      <p className="text-sm text-muted-foreground">
        At most one reply per person in 24 hours. New incoming messages only. “Stop” disables future
        replies for that person.
      </p>
      <p role="status" className="text-sm">
        {query.isError ? "Could not load the reply status." : status}
      </p>
      <div className="flex flex-wrap gap-2">
        {s && !s.ready && (
          <Button disabled={connect.isPending} onClick={() => connect.mutate()}>
            Connect Kiikii messaging
          </Button>
        )}
        <Button
          variant="outline"
          disabled={!s?.ready || change.isPending}
          onClick={() => change.mutate({ data: { action: "enable_test" } })}
        >
          Enable test for user_diary01
        </Button>
        <Button
          disabled={!s?.ready || change.isPending || !s.receipts.some((r) => r.status === "sent")}
          onClick={() => change.mutate({ data: { action: "enable_live" } })}
        >
          Enable for all visitors
        </Button>
        {s?.mode !== "off" && (
          <Button
            variant="outline"
            disabled={change.isPending}
            onClick={() => change.mutate({ data: { action: "pause" } })}
          >
            Pause replies
          </Button>
        )}
      </div>
      {s?.mode === "test" && (
        <p className="text-sm">
          Send a fresh “hey” from @user_diary01 to @kiikii.bat. Check that one reply arrives and its
          link opens the website chat. Other accounts receive no reply during this test.
        </p>
      )}
      {(change.error || connect.error) && (
        <p role="alert" className="text-sm text-destructive">
          {change.error?.message ?? connect.error?.message}
        </p>
      )}
      {!!s?.receipts.length && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {s.receipts.map((r, i) => (
            <li key={i}>
              {new Date(r.received_at).toLocaleString("de-DE")} ·{" "}
              {r.status === "sent"
                ? "Meta accepted the reply; verify it on the receiving account."
                : r.status === "reserved" || r.status === "uncertain"
                  ? "Delivery unconfirmed. No automatic retry."
                  : r.status === "cooldown"
                    ? "No extra reply: 24-hour limit."
                    : r.status === "opted_out"
                      ? "Replies stopped for this person."
                      : `Send failed (${r.error_code ?? "unknown"}). Check Meta access.`}
            </li>
          ))}
        </ul>
      )}
      <details>
        <summary className="cursor-pointer text-sm">Preview all 30 replies</summary>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
          {DM_REPLIES.map((reply) => (
            <li key={reply}>{reply}</li>
          ))}
        </ol>
      </details>
    </section>
  );
}
