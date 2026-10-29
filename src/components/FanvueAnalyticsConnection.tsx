import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fanvueAnalyticsFn } from "@/lib/fanvue-analytics.functions";
import { FANVUE_CALLBACK } from "@/lib/fanvue-analytics";
import { Button } from "@/components/ui/button";
export function FanvueAnalyticsConnection({ userId }: { userId: string }) {
  const [secret, setSecret] = useState(""),
    cache = useQueryClient();
  const q = useQuery({
    queryKey: ["fanvue-connection", userId],
    queryFn: () => fanvueAnalyticsFn({ data: { action: "status" } }),
  });
  const mutation = useMutation({
    mutationFn: (action: "configure" | "connect" | "sync" | "disconnect") =>
      fanvueAnalyticsFn({
        data: action === "configure" ? { action, clientSecret: secret } : { action },
      }),
    onSuccess: async (r) => {
      setSecret("");
      cache.setQueryData(["fanvue-connection", userId], r);
      await cache.invalidateQueries({ queryKey: ["business-report", userId] });
      if (r.url) window.location.assign(r.url);
    },
  });
  const s = q.data?.status;
  return (
    <section className="rounded-2xl border border-cyan-400/30 bg-[#101321] p-5 space-y-4">
      <h2 className="text-xl font-semibold text-cyan-200">📡 Connect Fanvue</h2>
      <p className="text-sm text-slate-300">
        {s?.connected
          ? `Connected to @${s.handle}`
          : "Connect once. Syncs automatically each day before the 20:00 report."}
      </p>
      {s?.lastSynced && (
        <p className="text-sm text-slate-400">
          Last successful sync:{" "}
          {new Date(s.lastSynced).toLocaleString("de-DE", { timeZone: "Europe/Berlin" })} Berlin
          time
        </p>
      )}
      {typeof window !== "undefined" &&
        new URLSearchParams(window.location.search).get("fanvue") === "error" && (
          <p role="alert" className="text-amber-200">
            Sign-in incomplete. Please reconnect and select @kiikiixoxo.
          </p>
        )}
      {(q.error || mutation.error || s?.error) && (
        <p role="alert" className="text-amber-200">
          {q.error?.message ?? mutation.error?.message ?? s?.error}
        </p>
      )}
      {s && (!s.configured || (!s.connected && s.error?.includes("invalid_client"))) && (
        <div className="space-y-3">
          <p className="text-sm">
            Paste your app's current client secret here. It is encrypted on the server and will not
            be shown again.
          </p>
          <label className="block text-sm" htmlFor="fanvue-secret">
            Fanvue Client Secret
          </label>
          <input
            id="fanvue-secret"
            type="password"
            autoComplete="new-password"
            data-lpignore="true"
            data-1p-ignore="true"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            className="w-full rounded-lg border border-white/20 bg-black/40 p-3"
          />
          <Button
            className="h-14 w-full"
            disabled={mutation.isPending || secret.trim().length < 16}
            onClick={() => mutation.mutate("configure")}
          >
            {s.configured ? "Replace secret securely" : "Save credentials securely"}
          </Button>
          <details className="text-sm text-slate-400">
            <summary>Fanvue setup</summary>
            <p className="mt-2">
              App: Kiikii HQ Analytics · Read permissions: read:self, read:insights. Redirect URL:
            </p>
            <code className="break-all">{FANVUE_CALLBACK}</code>
          </details>
        </div>
      )}
      {s?.configured && (
        <div className="flex flex-wrap gap-3">
          {(!s.connected || s.needsReconnect) && (
            <Button
              className="h-14 px-8"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate("connect")}
            >
              Connect to Fanvue
            </Button>
          )}
          {s.connected && !s.needsReconnect && (
            <Button
              className="h-14 px-8"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate("sync")}
            >
              Sync Fanvue now
            </Button>
          )}
          {s.connected && (
            <Button
              variant="outline"
              className="h-14"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate("disconnect")}
            >
              Disconnect
            </Button>
          )}
        </div>
      )}
      {mutation.isPending && <p role="status">Updating connection …</p>}
      <p className="text-xs text-slate-400">
        Reads account data and analytics only. Manual syncs are limited to once every 10 minutes. No
        messages, uploads or publishing. Disconnecting removes stored tokens; you can also revoke
        app access in Fanvue.
      </p>
    </section>
  );
}
