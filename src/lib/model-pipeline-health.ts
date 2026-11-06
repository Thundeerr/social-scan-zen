export type PipelineHealthInput = {
  configured?: boolean;
  enabled?: boolean;
  last_seen_at?: string | null;
  queued?: number;
  oldest_queued_at?: string | null;
};

// The worker normally checks in every 30 seconds. A stale heartbeat is evidence
// of missing contact, not proof of a crash or permission to restart paid work.
export const WORKER_HEARTBEAT_MAX_AGE_MS = 10 * 60 * 1000;
export function pipelineHealth(input: PipelineHealthInput | null | undefined, now = new Date()) {
  const stamp = input?.last_seen_at ? Date.parse(input.last_seen_at) : NaN;
  const age = now.valueOf() - stamp;
  const valid = Number.isFinite(age) && age >= -60_000;
  const worker = !input
    ? "unknown"
    : !input.last_seen_at
      ? "never_seen"
      : !valid
        ? "unknown"
        : age > WORKER_HEARTBEAT_MAX_AGE_MS
          ? "stale"
          : "reachable";
  const oldest = input?.oldest_queued_at ? Date.parse(input.oldest_queued_at) : NaN;
  const queueAge = Math.max(0, now.valueOf() - oldest);
  return {
    configured: input?.configured ?? null,
    enabled: input?.enabled ?? null,
    worker,
    lastSeenAt: valid ? input!.last_seen_at! : null,
    ageSeconds: valid ? Math.max(0, Math.floor(age / 1000)) : null,
    queued: input?.queued ?? null,
    oldestQueuedAt: Number.isFinite(queueAge) ? input!.oldest_queued_at! : null,
    queueAgeSeconds: Number.isFinite(queueAge) ? Math.floor(queueAge / 1000) : null,
    needsAttention:
      input?.enabled === true &&
      (worker !== "reachable" || ((input.queued ?? 0) > 0 && queueAge >= 86_400_000)),
  };
}

export function pipelineHealthText(health: ReturnType<typeof pipelineHealth>) {
  const setting =
    health.enabled === null
      ? "Generierungsstatus unbekannt"
      : health.enabled
        ? "Generierung aktiviert"
        : "Generierung pausiert";
  const contact = {
    reachable: "Worker kürzlich erreichbar",
    stale: "keine aktuelle Worker-Meldung",
    never_seen: "Worker noch nicht gemeldet",
    unknown: "Worker-Status unbekannt",
  }[health.worker];
  const waiting = health.queued === null ? "" : ` · ${health.queued} Jobs warten`;
  const age =
    health.queueAgeSeconds !== null && health.queueAgeSeconds >= 86400
      ? ` · ältester seit ${Math.floor(health.queueAgeSeconds / 86400)} Tagen`
      : "";
  return `${setting} · ${contact}${waiting}${age}`;
}
