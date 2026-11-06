import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  profit: vi.fn(),
  histories: {} as Record<string, unknown[]>,
  filters: [] as string[],
}));
vi.mock("./business-profit", () => ({ profitEstimate: mock.profit }));
vi.mock("./wavespeed-analytics.server", () => ({ waveStatus: async () => null }));
vi.mock("./messaging/telegram-transport", () => ({ channelAlertTelegramCall: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      let source = "";
      const chain: any = {
        select: () => chain,
        eq: (key: string, value: string) => {
          mock.filters.push(`${table}:${key}:${value}`);
          if (key === "source") source = value;
          return chain;
        },
        order: () => chain,
        limit: () => chain,
        maybeSingle: () => chain,
        then: (resolve: any) =>
          resolve({
            error: null,
            data:
              table === "business_report_settings"
                ? { enabled: true }
                : table !== "business_metric_snapshots"
                  ? []
                  : source
                    ? (mock.histories[source] ?? [])
                    : Array.from({ length: 100 }, (_, i) => ({
                        source: "Fanvue API",
                      period_start: new Date(Date.UTC(2026, 10, 6 - i)).toISOString().slice(0, 10),
                      period_end: new Date(Date.UTC(2026, 10, 6 - i)).toISOString().slice(0, 10),
                        observed_at: `2026-11-06T17:${String(i % 60).padStart(2, "0")}:00Z`,
                        values: {},
                        note: "",
                      })),
          }),
      };
      return chain;
    },
    rpc: async () => ({
      error: null,
      data: {
        published_today: 0,
        scheduled: 0,
        review_pending: 5,
        reserved_month_cents: 0,
        generation_worker: {
          configured: true,
          enabled: true,
          last_seen_at: "2026-10-26T17:19:00Z",
          queued: 2,
          oldest_queued_at: "2026-10-24T10:00:00Z",
        },
      },
    }),
  },
}));
import { businessReport } from "./business-report.server";

beforeEach(() => {
  mock.filters.length = 0;
  mock.histories = {};
  mock.profit.mockReset().mockReturnValue(null);
});
it("keeps tariff history outside the recent API window and displays worker evidence", async () => {
  const source = "CupidBot laufende Abos (Portal)";
  mock.histories[source] = ["2026-10-20", "2026-10-01"].map((day, i) => ({
    source,
    period_start: day,
    period_end: day,
    observed_at: `${day}T12:00:00Z`,
    values: { "Monatsmittel USD": i ? 128 : 0 },
    note: "Tariff evidence",
  }));
  const report = await businessReport("owner", new Date("2026-11-06T18:00:00Z"));
  const fullHistory = mock.profit.mock.calls[0][0];
  expect(fullHistory.filter((s: { source: string }) => s.source === source)).toHaveLength(2);
  expect(mock.profit.mock.calls[0][3]).toBe("2026-11-06");
  expect(report.snapshots.filter((s) => s.source === source)).toHaveLength(1);
  expect(report.profit).toBe(null);
  expect(report.text).toContain("keine aktuelle Worker-Meldung");
  expect(report.text).toContain("2 Jobs warten");
  expect(report.workerHealth.needsAttention).toBe(true);
  expect(mock.filters.filter((s) => s === "business_metric_snapshots:user_id:owner")).toHaveLength(
    6,
  );
});
it("refuses a truncated cost history instead of silently choosing a wrong tariff", async () => {
  mock.histories["CupidBot laufende Abos (Portal)"] = Array(1000).fill({});
  await expect(businessReport("owner")).rejects.toThrow("Kostenhistorie zu groß");
  expect(mock.profit).not.toHaveBeenCalled();
});
