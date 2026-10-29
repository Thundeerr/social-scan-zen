import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { channelAlertsFn } from "@/lib/channel-alerts.functions";
import type { AlertAction, AlertChannel } from "@/lib/channel-alerts";
import { Button } from "./ui/button";
import { startInstagramOAuthFn } from "@/lib/instagram-oauth.functions";
export function ChannelAlerts({ userId }: { userId: string }) {
  const cache = useQueryClient(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const key = ["channel-alerts", userId];
  const query = useQuery({
    queryKey: key,
    queryFn: () => channelAlertsFn({ data: { action: "status" } }),
    refetchInterval: 60000,
  });
  async function act(data: AlertAction) {
    setBusy(true);
    setError("");
    try {
      await channelAlertsFn({ data });
      await cache.invalidateQueries({ queryKey: key });
    } catch {
      setError("Action failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="rounded-xl border bg-card p-4">
      <summary className="cursor-pointer font-medium">
        Channel announcements · Kiikii & Tuuva
      </summary>
      <p className="my-3 text-sm text-muted-foreground">
        After a successful cloud post: at most once per calendar day per channel (German time).
        Deleted after 12 hours, checked every minute. Posts published manually on Instagram are not
        detected here yet.
      </p>
      {error && <p role="alert">{error}</p>}
      {query.error && <p role="alert">Channel status unavailable.</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {query.data?.channels.map((c) => (
          <Channel
            key={c.model}
            channel={c}
            busy={busy}
            connections={query.data.connections}
            act={act}
          />
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Last cloud check:{" "}
        {query.data?.last_tick
          ? new Date(query.data.last_tick).toLocaleString("en-GB", { timeZone: "Europe/Berlin" })
          : "pending"}
      </p>
      {query.data?.alerts.map((a) => (
        <p key={a.id} className="mt-2 text-sm">
          {a.model}:{" "}
          {a.state === "deleted"
            ? "Announcement deleted"
            : a.state === "sent"
              ? `Deletion scheduled: ${a.delete_after ? new Date(a.delete_after).toLocaleString("en-GB", { timeZone: "Europe/Berlin" }) : "pending"}`
              : a.state === "uncertain"
                ? "Delivery unclear — check the channel"
                : a.state === "delete_failed"
                  ? "Deletion failed — remove the message manually"
                  : a.state === "skipped"
                    ? "Announcement skipped"
                    : a.state === "deleting"
                      ? "Deleting"
                      : a.state === "sending"
                        ? "Sending"
                        : "Waiting"}
          {a.error_code === "delete_retry" ? " · Retrying deletion" : ""}
        </p>
      ))}
    </details>
  );
}
function Channel({
  channel: c,
  busy,
  connections,
  act,
}: {
  channel: AlertChannel;
  busy: boolean;
  connections: { id: string; username: string }[];
  act: (a: AlertAction) => Promise<void>;
}) {
  const [connection, setConnection] = useState("");
  const [authorizeUrl, setAuthorizeUrl] = useState("");
  const [connectError, setConnectError] = useState("");
  const [connecting, setConnecting] = useState(false);
  async function connect() {
    setConnecting(true);
    setConnectError("");
    try {
      const { authorizeUrl: url } = await startInstagramOAuthFn({ data: { destination: c.model } });
      setAuthorizeUrl(url);
    } catch {
      setConnectError("Could not start the Instagram connection.");
    } finally {
      setConnecting(false);
    }
  }
  const label = c.model === "kiikii" ? "Kiikii" : "Tuuva";
  return (
    <section className="rounded-lg border p-3 space-y-3">
      <h3 className="font-medium">{label}</h3>
      <p className="text-sm">
        {!c.enabled
          ? "Announcements paused"
          : !c.ig_username
            ? "Waiting for an assigned Instagram account"
            : !c.bot_ready
              ? "Bot permission not confirmed yet"
              : "Automatic announcements enabled"}
      </p>
      <p className="text-xs text-muted-foreground">
        {c.ig_username ? "Instagram: @" + c.ig_username : "No Instagram account assigned yet"} ·{" "}
        {c.bot_ready ? "Bot can post and delete its own messages" : "Check bot access"}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={connecting || busy} onClick={() => void connect()}>
          {c.ig_username ? "Reconnect " + label : "Connect " + label + " to Instagram"}
        </Button>
        {authorizeUrl && (
          <Button size="sm" asChild>
            <a href={authorizeUrl} target="_blank" rel="noopener noreferrer">
              Open Instagram for {label}
            </a>
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void act({ action: "check", model: c.model })}
        >
          Check bot for {label}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void act({ action: "configure", model: c.model, enabled: !c.enabled })}
        >
          {c.enabled ? "Pause" : "Enable"}
        </Button>
      </div>
      {connectError && (
        <p role="alert" className="text-sm">
          {connectError}
        </p>
      )}
      <details>
        <summary className="text-sm cursor-pointer">Change Instagram account</summary>
        <p className="my-2 text-xs">
          Select the correct {label} account. Assigning an account does not send announcements for
          previous posts.
        </p>
        <select
          aria-label={label + " Instagram account"}
          className="w-full rounded border bg-background p-2 text-sm"
          value={connection}
          onChange={(e) => setConnection(e.target.value)}
        >
          <option value="">Select account</option>
          {connections.map((a) => (
            <option key={a.id} value={a.id}>
              @{a.username}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !connection}
          className="mt-2"
          onClick={() =>
            void act({ action: "configure", model: c.model, connection_id: connection })
          }
        >
          Assign this account to {label}
        </Button>
        {c.ig_username && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void act({ action: "configure", model: c.model, connection_id: null })}
          >
            Remove assignment
          </Button>
        )}
      </details>
    </section>
  );
}
