import { describe, expect, it } from "vitest";
import { pipelineHealth, pipelineHealthText } from "./model-pipeline-health";

describe("worker health evidence", () => {
  const now = new Date("2026-11-06T18:00:00Z");
  it("does not treat enabled as a running worker", () => {
    const health = pipelineHealth(
      {
        enabled: true,
        last_seen_at: "2026-10-26T17:19:05Z",
        queued: 2,
        oldest_queued_at: "2026-10-24T10:00:00Z",
      },
      now,
    );
    expect(health.worker).toBe("stale");
    expect(health.needsAttention).toBe(true);
    expect(health.queueAgeSeconds).toBeGreaterThan(86400);
    expect(pipelineHealthText(health)).toContain("keine aktuelle Worker-Meldung");
  });
  it("distinguishes paused configuration from reachable worker", () => {
    const health = pipelineHealth(
      {
        enabled: false,
        last_seen_at: "2026-11-06T17:59:30Z",
        queued: 2,
        oldest_queued_at: "2026-10-24T10:00:00Z",
      },
      now,
    );
    expect(health.worker).toBe("reachable");
    expect(health.needsAttention).toBe(false);
    expect(pipelineHealthText(health)).toContain("pausiert");
  });
  it("handles missing, invalid and future heartbeat without claiming health", () => {
    expect(pipelineHealth(undefined, now).worker).toBe("unknown");
    expect(pipelineHealth({ enabled: true, last_seen_at: null }, now).worker).toBe("never_seen");
    for (const last_seen_at of ["invalid", "2026-11-07T18:00:00Z"])
      expect(pipelineHealth({ enabled: true, last_seen_at }, now).worker).toBe("unknown");
  });
  it("uses a bounded heartbeat age and flags old queued work separately", () => {
    expect(
      pipelineHealth({ enabled: true, last_seen_at: "2026-11-06T17:50:00Z" }, now).worker,
    ).toBe("reachable");
    expect(
      pipelineHealth({ enabled: true, last_seen_at: "2026-11-06T17:49:59Z" }, now).worker,
    ).toBe("stale");
    expect(
      pipelineHealth(
        {
          enabled: true,
          last_seen_at: now.toISOString(),
          queued: 1,
          oldest_queued_at: "2026-11-05T18:00:00Z",
        },
        now,
      ).needsAttention,
    ).toBe(true);
  });
});
