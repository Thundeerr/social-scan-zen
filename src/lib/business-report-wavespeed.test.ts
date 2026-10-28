import { expect, it, vi } from "vitest";
vi.mock("./messaging/telegram-transport", () => ({ channelAlertTelegramCall: vi.fn() }));
vi.mock("./wavespeed-analytics.server", () => ({
  waveStatus: async () => ({
    error: null,
    report: {
      month: "2026-10",
      observed: "2026-10-28T17:38:44Z",
      balance: 2.8339,
      net: 267.7801,
      kiikii: 89.8,
      tuuva: 2,
      unassigned: 175.9801,
      charged: 267.8341,
      refunded: 0.054,
      unknownTypes: 0,
    },
  }),
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const data =
        table === "business_report_settings"
          ? { monthly_budget_cents: 40000, enabled: true }
          : table === "business_cost_allocations"
            ? [
                {
                  reference: "chatgpt",
                  label: "ChatGPT",
                  model: "kiikii",
                  currency: "EUR",
                  monthly_cents: 5725,
                  effective_from: "2026-10-28",
                  planned: false,
                  note: "25%",
                },
                {
                  reference: "lovable",
                  label: "Lovable",
                  model: "kiikii",
                  currency: "USD",
                  monthly_cents: 1000,
                  effective_from: "2026-10-28",
                  planned: false,
                  note: "Confirmed",
                },
              ]
            : table === "business_cost_entries"
              ? [
                  {
                    reference: "old",
                    label: "Old estimate",
                    scope: "kiikii",
                    kind: "fixed",
                    cents: 9000,
                    day: "2026-10-01",
                    end_day: null,
                    note: "",
                  },
                ]
              : [
                  {
                    source: "Fanvue API",
                    period_start: "2026-10-01",
                    period_end: "2026-10-28",
                    observed_at: "2026-10-28T16:52:28Z",
                    values: { "Subs gesamt": 27, "Netto vor Betriebskosten USD": 717.61 },
                  },
                ];
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: () => chain,
        then: (resolve: any) => resolve({ data, error: null }),
      };
      return chain;
    },
    rpc: async () => ({
      error: null,
      data: {
        published_today: 2,
        scheduled: 13,
        review_pending: 5,
        jobs_today: 0,
        last_scheduled: "2026-11-04T00:00:00Z",
        reserved_month_cents: 10000,
      },
    }),
  },
}));
it("daily report includes actual costs and fits Telegram without sending", async () => {
  const { businessReport } = await import("./business-report.server");
  const r = await businessReport("operator", new Date("2026-10-28T19:00:00Z"));
  expect(r.text.length).toBeLessThanOrEqual(4000);
  expect(r.text).toContain("267.78 $");
  expect(r.text).toContain("89.80 $");
  expect(r.text).toContain("unzugeordnet 175.98 $");
  expect(r.text).toContain("Automatischer Abruf pausiert");
  expect(r.costs.fixed).toBe(1000);
  expect(r.allocation.totals.kiikii.EUR).toBe(5725);
  expect(r.entries[0].cents).toBe(9000);
  const { channelAlertTelegramCall } = await import("./messaging/telegram-transport");
  expect(channelAlertTelegramCall).not.toHaveBeenCalled();
});
