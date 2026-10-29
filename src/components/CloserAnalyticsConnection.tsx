import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { closerAnalyticsFn } from "@/lib/closer-analytics.functions";
import { Button } from "@/components/ui/button";
export function CloserAnalyticsConnection({ userId }: { userId: string }) {
  const [token, setToken] = useState("");
  const cache = useQueryClient(),
    key = ["closer-analytics", userId];
  const q = useQuery({
    queryKey: key,
    queryFn: () => closerAnalyticsFn({ data: { action: "status" } }),
  });
  const m = useMutation({
    mutationFn: (action: "configure" | "sync") =>
      closerAnalyticsFn({ data: action === "configure" ? { action, token } : { action } }),
    onSettled: async () => {
      setToken("");
      await cache.invalidateQueries({ queryKey: key });
      await cache.invalidateQueries({ queryKey: ["business-report", userId] });
    },
  });
  const s = q.data?.status;
  return (
    <section className="rounded-2xl border border-violet-400/30 bg-[#101321] p-5 space-y-4">
      <h2 className="text-xl font-semibold text-violet-200">📡 IG Closer · Kiikii</h2>
      <p className="text-sm text-slate-300">
        Conversations → link shared → reported conversion. Daily before the 20:00 report.
      </p>
      {s?.lastSynced && (
        <p className="text-sm text-slate-400">
          Last sync: {new Date(s.lastSynced).toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}{" "}
          Berlin time
        </p>
      )}
      {(q.error || m.error || s?.error) && (
        <p role="alert" className="text-amber-200">
          {q.error?.message ?? m.error?.message ?? s?.error}
        </p>
      )}
      {s && (!s.configured || s.error?.includes("HTTP 401") || s.error?.includes("HTTP 403")) && (
        <div className="space-y-3">
          <p className="text-sm text-slate-300">
            CupidBot → Profile → Account → <strong>Access token</strong>. Paste it here, not the
            Chatter token. Stored encrypted on the server.
          </p>
          <label htmlFor="closer-token" className="block text-sm">
            CupidBot Access token
          </label>
          <input
            id="closer-token"
            type="password"
            autoComplete="new-password"
            data-lpignore="true"
            data-1p-ignore="true"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="w-full rounded-lg border border-white/20 bg-black/40 p-3"
          />
          <Button
            className="h-14 w-full bg-violet-600 hover:bg-violet-700"
            disabled={m.isPending || token.trim().length < 16}
            onClick={() => m.mutate("configure")}
          >
            Connect Closer securely
          </Button>
        </div>
      )}
      {s?.configured && (
        <Button className="h-14 px-8" disabled={m.isPending} onClick={() => m.mutate("sync")}>
          Sync Closer now
        </Button>
      )}
      {m.isPending && <p role="status">Checking Closer access …</p>}
      {m.data?.skipped && (
        <p role="status">Synced recently. Wait at least 10 minutes before trying again.</p>
      )}
      <p className="text-xs text-slate-400">
        Kiikii analytics only. No messages sent. Covers seven completed days; conversions are not
        confirmed paying subscribers.
      </p>
    </section>
  );
}
