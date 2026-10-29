import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { modelPipelineFn } from "@/lib/model-pipeline.functions";
import { Button } from "./ui/button";
export function ModelPipeline() {
  const cache = useQueryClient(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [token, setToken] = useState("");
  const query = useQuery({
    queryKey: ["model-pipeline"],
    queryFn: () => modelPipelineFn({ data: { action: "status" } }),
    refetchInterval: 30000,
  });
  const p = query.data;
  async function act(action: "pair" | "pause" | "enable") {
    setBusy(true);
    setError("");
    try {
      const result = await modelPipelineFn({ data: { action } });
      if (result.token) setToken(result.token);
      await cache.invalidateQueries({ queryKey: ["model-pipeline"] });
    } catch {
      setError("Action not confirmed. Check your connection.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="rounded-xl border bg-card p-4">
      <summary className="cursor-pointer font-medium">Generation pipeline</summary>
      <div className="mt-4 space-y-3">
        <p>Instagram → FollowerStar → generation → Telegram review → Instagram</p>
        <p>
          {p?.enabled ? "Processing enabled" : "Processing paused"} ·{" "}
          {p?.last_seen_at
            ? "Server last seen: " + new Date(p.last_seen_at).toLocaleString()
            : "Cloud server not connected yet"}
        </p>
        {(p?.profiles ?? []).map((m: { model: string; sender_username: string | null }) => (
          <p key={m.model}>
            {m.model}:{" "}
            {m.sender_username ? "@" + m.sender_username : "Instagram sender not set yet"}
          </p>
        ))}
        <div className="flex gap-2">
          <Button
            disabled={busy || !p?.last_seen_at}
            onClick={() => void act(p?.enabled ? "pause" : "enable")}
          >
            {p?.enabled ? "Pause generation" : "Enable generation"}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          The daily budget is shared by both models and resets on German calendar days. Jobs wait
          when the budget is insufficient. Public posts still require your approval.
        </p>
        {(p?.jobs ?? []).map(
          (j: { id: string; model: string; state: string; issue: string | null }) => (
            <p className="text-sm" key={j.id}>
              {j.model} ·{" "}
              {
                (
                  {
                    queued: "Waiting for server",
                    working: "Preparing source",
                    budget_wait: "Waiting for daily budget",
                    reserved: "Generation reserved",
                    generating: "Generating video",
                    review: "Ready for review",
                    blocked: "Needs attention",
                  } as Record<string, string>
                )[j.state]
              }
              {j.issue ? " · " + j.issue : ""}
            </p>
          ),
        )}
        <details>
          <summary>Server setup</summary>
          <p className="my-3 text-sm">
            A new key replaces the current key and pauses processing. Only enter it in the protected
            server configuration.
          </p>
          <Button disabled={busy} onClick={() => void act("pair")}>
            Generate new server key
          </Button>
          {token && (
            <>
              <textarea
                className="mt-3 w-full rounded border bg-background p-3"
                readOnly
                value={token}
                aria-label="Server key"
              />
              <Button variant="outline" onClick={() => setToken("")}>
                Hide key
              </Button>
            </>
          )}
        </details>
        {(error || query.error) && <p role="alert">{error || "Pipeline status unavailable."}</p>}
      </div>
    </details>
  );
}
