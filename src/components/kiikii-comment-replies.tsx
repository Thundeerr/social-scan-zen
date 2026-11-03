import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { kiikiiCommentRepliesFn } from "@/lib/kiikii-comment-replies.functions";
import { Button } from "@/components/ui/button";

export function KiikiiCommentReplies({ userId }: { userId: string }) {
  const cache = useQueryClient();
  const key = ["kiikii-comment-replies", userId];
  const query = useQuery({
    queryKey: key,
    queryFn: () => kiikiiCommentRepliesFn({ data: { action: "status" } }),
    refetchInterval: 15000,
  });
  const change = useMutation({
    mutationFn: kiikiiCommentRepliesFn,
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: key });
    },
  });
  const s = query.data;
  return (
    <section id="kiikii-comment-replies" className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="font-medium">Kiikii · Heart comments get a private chat link</h2>
      <p className="text-sm">
        Hearts in any color, heart hands and {"<3"} trigger one private reply with the website chat
        link. No public reply is posted.
      </p>
      <p className="text-sm text-muted-foreground">
        Each post’s current caption is checked too. For example, “comment CHAT” or “drop a 🦇” adds
        that trigger for that post, including future posts. Decorative emojis in a caption don’t
        become triggers.
      </p>
      <p className="text-sm text-muted-foreground">
        New comments on Kiikii’s posts and reels only. Comments and DMs share one reply per person
        per 24 hours. Pausing the main DM responder also pauses these replies.
      </p>
      <p role="status" className="text-sm">
        {query.isError
          ? "Could not load comment reply status."
          : !s
            ? "Loading…"
            : !s.ready
              ? "Enable Kiikii messaging above and connect with comment permission."
              : s.mode === "live"
                ? "Enabled for new matching comments."
                : s.mode === "test"
                  ? `Comment test: only @${s.testUsername} receives a reply.`
                  : "Comment replies are paused."}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={!s?.ready || change.isPending}
          onClick={() => change.mutate({ data: { action: "enable_test" } })}
        >
          Test heart comments
        </Button>
        <Button
          disabled={!s?.ready || !s.tested || change.isPending}
          onClick={() => change.mutate({ data: { action: "enable_live" } })}
        >
          Enable comment replies for everyone
        </Button>
        {s && s.mode !== "off" && (
          <Button
            variant="outline"
            disabled={change.isPending}
            onClick={() => change.mutate({ data: { action: "pause" } })}
          >
            Pause comment replies
          </Button>
        )}
      </div>
      {s?.mode === "test" && (
        <p className="text-sm">
          From @{s.testUsername}, leave a new 🖤 comment on a Kiikii post or reel. Check the private
          reply and open its link before enabling for everyone. If this account already received a
          link reply within 24 hours, the limit still applies.
        </p>
      )}
      {change.error && (
        <p role="alert" className="text-sm text-destructive">
          {change.error.message}
        </p>
      )}
      {!!s?.receipts.length && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {s.receipts.map((r, i) => (
            <li key={i}>
              {new Date(r.received_at).toLocaleString("de-DE")} ·{" "}
              {r.status === "sent"
                ? "Meta accepted the private reply; verify it on the receiving account."
                : r.status === "cooldown"
                  ? "No extra reply: 24-hour limit."
                  : r.status === "opted_out"
                    ? "Replies stopped for this person."
                    : r.status === "reserved" || r.status === "uncertain"
                      ? "Delivery unconfirmed. No automatic retry."
                      : `Send failed (${r.error_code ?? "unknown"}). Check Meta access.`}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
