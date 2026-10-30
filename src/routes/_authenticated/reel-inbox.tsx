import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { reelInboxFn } from "@/lib/reel-inbox.functions";
import { stages, type InboxSnapshot } from "@/lib/reel-inbox";
import { Button } from "@/components/ui/button";
import { CopyVideoButton } from "@/components/copy-video-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ReelInboxDm } from "@/components/reel-inbox-dm";

export const Route = createFileRoute("/_authenticated/reel-inbox")({ component: ReelInbox });
const statuses = {
  queued: "Waiting for PC",
  working: "PC processing",
  ready: "Confirmed on PC",
  failed: "Action required",
};
const stageLabels: Record<(typeof stages)[number], string> = {
  Neu: "New",
  "In Arbeit": "In progress",
  Verwendet: "Used",
};
const errors: Record<string, string> = {
  unavailable: "Could not retrieve this video. The original link is saved; this does not necessarily mean the reel is private or deleted.",
  unsupported: "This reel is not currently supported.",
  interrupted: "Download interrupted. Try again.",
  validation: "The downloaded file failed video validation.",
  path_blocked: "The local destination folder is not allowed.",
  disk_error: "Could not save the file. Check storage space and OneDrive.",
  conflict: "File conflict: nothing was overwritten.",
  setup: "Check the PC helper, video tools, and download API configuration or request allowance.",
};
function ReelInbox() {
  const { user } = Route.useRouteContext();
  const cache = useQueryClient();
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [test, setTest] = useState(false);
  const [message, setMessage] = useState("");
  const [token, setToken] = useState("");
  const [before, setBefore] = useState<string>();
  const key = ["reel-inbox", user.id, before];
  const query = useQuery({
    queryKey: key,
    queryFn: async () => (await reelInboxFn({ data: { action: "list", before } })) as InboxSnapshot,
    refetchInterval: 15000,
  });
  const mutation = useMutation({
    mutationFn: reelInboxFn,
    onSuccess: () => cache.invalidateQueries({ queryKey: ["reel-inbox", user.id] }),
  });
  async function send() {
    setMessage("");
    try {
      const result = await mutation.mutateAsync({ data: { action: "submit", text, test } });
      const count = result.results.filter((r: { duplicate: boolean }) => !r.duplicate).length;
      setMessage(
        `${count} newly saved · ${result.results.length - count} already saved${result.invalid.length ? ` · Invalid: ${result.invalid.join(", ")}` : ""}`,
      );
      setText(result.invalid.join("\n"));
      setBefore(undefined);
    } catch {
      setMessage("Not confirmed yet. Your links stay here. Please try again.");
    }
  }
  const device = query.data?.device;
  const online =
    device &&
    !device.revoked &&
    device.last_seen_at &&
    Date.now() - Date.parse(device.last_seen_at) < 90000;
  const items = (query.data?.items ?? []).filter((i) =>
    `${i.shortcode} ${i.receipt?.title ?? ""} ${i.receipt?.creator ?? ""} ${i.confirmed_stage ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <header>
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Kiikii · Sources</p>
        <h1 className="text-2xl font-semibold">Reel Inbox</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Paste links and send. Your PC saves available reels in your source folder.
        </p>
      </header>
      <p role="status" className="rounded-lg border p-3 text-sm">
        {online
          ? "PC online"
          : device?.revoked
            ? "PC pairing revoked"
            : "PC offline or not paired yet"}{" "}
        · Jobs remain saved online.
        {device?.last_seen_at && (
          <span> Last seen: {new Date(device.last_seen_at).toLocaleString("de-DE")}</span>
        )}
      </p>
      <ReelInboxDm userId={user.id} />
      <section className="space-y-3 rounded-xl border bg-card p-4">
        <label htmlFor="reels" className="font-medium">
          Instagram reel links
        </label>
        <Textarea
          id="reels"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder="https://www.instagram.com/reel/…"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={test} onChange={(e) => setTest(e.target.checked)} />
            Mark as test material
          </label>
          <Button disabled={!text.trim() || mutation.isPending} onClick={send}>
            Send
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Up to 50 links. No Instagram login required. Reels that are not publicly available will
          show an error.
        </p>
        {message && (
          <p role="status" className="break-words text-sm">
            {message}
          </p>
        )}
      </section>
      {(query.isError || mutation.isError) && (
        <p role="alert" className="text-destructive">
          {String((query.error || mutation.error)?.message || "Connection failed")}
        </p>
      )}
      <Input
        aria-label="Search reels"
        placeholder="Search loaded reels by title, creator, status or ID"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {query.isLoading && <p>Loading inbox …</p>}
      {!query.isLoading && !query.isError && !items.length && (
        <p className="text-muted-foreground">Your saved links appear here.</p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {items.map((item) => (
          <article key={item.id} className="space-y-3 rounded-xl border bg-card p-4">
            {typeof item.receipt?.thumbnail === "string" && (
              <img
                src={item.receipt.thumbnail}
                alt="Reel-Vorschau"
                loading="lazy"
                className="h-56 w-full rounded-lg object-contain"
              />
            )}
            <div>
              <span className="text-xs text-muted-foreground">
                {item.is_test ? "TEST MATERIAL · " : ""}
                {statuses[item.status]}
              </span>
              <h2 className="break-words font-medium">
                {String(item.receipt?.title || item.shortcode)}
              </h2>
              <p className="text-sm text-muted-foreground">
                {String(item.receipt?.creator || "Creator unknown")}
              </p>
            </div>
            <a
              href={item.canonical_url}
              target="_blank"
              rel="noreferrer"
              className="text-sm underline"
            >
              Open original reel
            </a>
            <p className="text-sm">
              Confirmed:{" "}
              {item.confirmed_stage ? stageLabels[item.confirmed_stage] : "Not saved locally yet"}
              {item.confirmed_stage && item.desired_stage !== item.confirmed_stage
                ? ` → ${stageLabels[item.desired_stage]} requested`
                : ""}
            </p>
            {item.receipt && (
              <p className="break-words text-xs text-muted-foreground">
                {String(item.receipt.folder)} ·{" "}
                {Math.round((Number(item.receipt.bytes) / 1024 / 1024) * 10) / 10} MB
                {item.receipt.gallery === false ? " · Gallery refresh pending" : ""}
              </p>
            )}
            {item.error_code && (
              <p role="status" className="text-sm text-destructive">
                {errors[item.error_code] || "PC error. Please check the status."}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <CopyVideoButton reference={item.canonical_url} />
              {item.status === "ready" &&
                stages.map((stage) => (
                  <Button
                    key={stage}
                    size="sm"
                    variant="outline"
                    disabled={mutation.isPending || stage === item.confirmed_stage}
                    onClick={() =>
                      mutation.mutate({ data: { action: "move", id: item.id, stage } })
                    }
                  >
                    {stageLabels[stage]}
                  </Button>
                ))}
              {item.status === "failed" && (
                <Button
                  size="sm"
                  onClick={() => mutation.mutate({ data: { action: "retry", id: item.id } })}
                  disabled={mutation.isPending}
                >
                  Try again
                </Button>
              )}
            </div>
          </article>
        ))}
      </div>
      <div className="flex gap-2">
        {before && (
          <Button variant="outline" onClick={() => setBefore(undefined)}>
            Latest
          </Button>
        )}
        {query.data?.items.length === 100 && (
          <Button variant="outline" onClick={() => setBefore(query.data!.items.at(-1)!.created_at)}>
            Load older
          </Button>
        )}
      </div>
      <details className="space-y-3 rounded-xl border p-4">
        <summary className="cursor-pointer font-medium">Connect / stop Windows PC</summary>
        <p className="text-sm">
          Pair one PC. A new key replaces the old one. Enter it only in “Einrichten.ps1” on your PC.
          It grants access only to process your Reel Inbox.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={mutation.isPending}
            onClick={async () => {
              if (window.confirm("Create a new PC key and revoke the previous one?")) {
                try {
                  const r = await mutation.mutateAsync({ data: { action: "pair" } });
                  setToken(r.token);
                } catch {
                  /* mutation error is shown */
                }
              }
            }}
          >
            Create PC key
          </Button>
          <Button
            variant="outline"
            disabled={mutation.isPending}
            onClick={() => {
              if (window.confirm("Revoke PC access? Your files will be kept.")) {
                setToken("");
                mutation.mutate({ data: { action: "revoke" } });
              }
            }}
          >
            Revoke PC access
          </Button>
        </div>
        {token && (
          <div>
            <p className="text-sm">Visible only now. Hide it after setup.</p>
            <Input aria-label="PC key" readOnly type="password" value={token} />
            <Button variant="outline" onClick={() => navigator.clipboard.writeText(token)}>
              Copy key
            </Button>
            <Button variant="ghost" onClick={() => setToken("")}>
              Hide
            </Button>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          On your PC: Stoppen.ps1 stops the helper. Deinstallieren.ps1 removes startup and pairing
          on this PC. Your media is kept.
        </p>
      </details>
    </div>
  );
}
