import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { instagramAnalyticsFn } from "@/lib/instagram-analytics.functions";
import { startInstagramOAuthFn } from "@/lib/instagram-oauth.functions";
import { Button } from "@/components/ui/button";
const number = (value?: number) => (value === undefined ? "—" : value.toLocaleString("de-DE"));
export function InstagramAnalyticsConnection({ userId }: { userId: string }) {
  const cache = useQueryClient(),
    key = ["instagram-analytics", userId];
  const query = useQuery({
    queryKey: key,
    queryFn: () => instagramAnalyticsFn({ data: { action: "status" } }),
  });
  const sync = useMutation({
    mutationFn: () => instagramAnalyticsFn({ data: { action: "sync" } }),
    onSuccess: async (r) => {
      cache.setQueryData(key, r);
      await cache.invalidateQueries({ queryKey: ["business-report", userId] });
    },
  });
  const connect = useMutation({
    mutationFn: () => startInstagramOAuthFn({ data: { destination: "kiikii", insights: true } }),
    onSuccess: (r) => window.location.assign(r.authorizeUrl),
  });
  const s = query.data?.status;
  return (
    <section className="rounded-2xl border border-fuchsia-400/30 bg-[#101321] p-5 space-y-4">
      <h2 className="text-xl font-semibold text-fuchsia-200">📡 Instagram · Kiikii</h2>
      <p className="text-sm text-slate-300">
        Daily follower sync. Grant Insights access for reach and reel performance too.
      </p>
      {s?.lastSynced && (
        <p className="text-sm text-slate-400">
          Last sync: {new Date(s.lastSynced).toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}{" "}
          Berlin time
        </p>
      )}
      {(query.error || sync.error || connect.error || s?.error) && (
        <p role="alert" className="text-amber-200">
          {query.error?.message ?? sync.error?.message ?? connect.error?.message ?? s?.error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        {s?.connected && (
          <Button
            className="h-14 px-8"
            onClick={() => sync.mutate()}
            disabled={sync.isPending || connect.isPending}
          >
            {sync.isPending ? "Syncing Instagram …" : "Sync Instagram now"}
          </Button>
        )}
        {s && (!s.connected || !s.insightsGranted) && (
          <Button
            className="h-14 px-8 bg-fuchsia-600 hover:bg-fuchsia-700"
            onClick={() => connect.mutate()}
            disabled={connect.isPending || sync.isPending}
          >
            Grant Instagram read access
          </Button>
        )}
      </div>
      {s && (!s.connected || !s.insightsGranted) && (
        <p className="text-sm text-amber-200">
          Select @kiikii.bat on Instagram and allow access to insights. Then return here.
        </p>
      )}
      {sync.data?.skipped && (
        <p role="status" className="text-sm text-cyan-200">
          Synced recently. Wait at least 10 minutes before trying again.
        </p>
      )}
      {!!s?.warnings.length && (
        <details className="text-sm text-amber-200">
          <summary className="cursor-pointer">Which metrics are still missing?</summary>
          {s.warnings.map((w, i) => (
            <p key={i} className="mt-2">
              {w}
            </p>
          ))}
        </details>
      )}
      {!!s?.history.length && (
        <details className="text-sm">
          <summary className="cursor-pointer py-2">View follower growth</summary>
          <p className="text-slate-400 mb-2">
            One data point per day since setup. Missing days are not estimated.
          </p>
          {s.history.map((h) => (
            <p key={h.day}>
              {h.day}: <strong>{number(h.followers)} Follower</strong>
            </p>
          ))}
        </details>
      )}
      {!!s?.reels.length && (
        <details>
          <summary className="cursor-pointer font-semibold py-2">Which reels perform best?</summary>
          <p className="my-3 text-xs text-slate-400">
            Reels from the latest 25 posts · sorted by views · lifetime metrics. Keep different post
            ages in mind. — means unknown.
          </p>
          <div className="space-y-3">
            {s.reels.map((r) => (
              <div key={r.id} className="rounded-xl border border-white/10 p-4">
                {r.url ? (
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-cyan-200 underline"
                  >
                    {r.caption || "Open reel"}
                  </a>
                ) : (
                  <p>{r.caption || "Reel"}</p>
                )}
                <p className="text-sm text-slate-300 mt-2">
                  {number(r.metrics.views)} views · {number(r.metrics.reach)} reached ·{" "}
                  {number(r.metrics.likes)} Likes · {number(r.metrics.comments)} comments ·{" "}
                  {number(r.metrics.saved)} saved · {number(r.metrics.shares)} shared
                </p>
              </div>
            ))}
          </div>
        </details>
      )}
      <p className="text-xs text-slate-400">
        Analytics only. Daily before the 20:00 report; manual syncs at most every 10 minutes.
        Instagram metrics may be delayed.
      </p>
    </section>
  );
}
