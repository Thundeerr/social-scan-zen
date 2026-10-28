import { describe, it, expect } from "vitest";
import { aggregateWave, wavePayload, type WavePayload } from "./wavespeed-analytics";
const base: WavePayload = {
  month: "2026-10",
  observed: "2026-10-28T19:00:00Z",
  balance: 2.8339,
  records: [],
};
const record = (id: string, type = "deduct", usd = 1.3, task: string | null = "p") => ({
  id,
  type,
  usd,
  task,
  at: "2026-10-25T18:00:00Z",
});
describe("WaveSpeed accounting", () => {
  it("counts fractional cents and refunds, deduplicates IDs", () => {
    const r = aggregateWave(
      { ...base, records: [record("a"), record("a"), record("b", "refund", 0.1001)] },
      [{ provider_id: "p", model: "kiikii" }],
    );
    expect(r.net).toBe(1.1999);
    expect(r.kiikii).toBe(1.1999);
    expect(r.recordCount).toBe(2);
  });
  it("does not assign unmatched or conflicting tasks to Kiikii", () => {
    const r = aggregateWave({ ...base, records: [record("a"), record("b", "deduct", 2, null)] }, [
      { provider_id: "p", model: "kiikii" },
      { provider_id: "p", model: "tuuva" },
    ]);
    expect(r.unassigned).toBe(3.3);
    expect(r.kiikii).toBe(0);
  });
  it("keeps unknown billing types out of spend", () => {
    const r = aggregateWave({ ...base, records: [record("a", "topup", 50)] }, []);
    expect(r.net).toBe(0);
    expect(r.unknownTypes).toBe(1);
  });
  it("rejects incomplete or malformed records", () => {
    expect(() => wavePayload.parse({ ...base, records: [{ id: "a" }] })).toThrow();
    expect(() => wavePayload.parse({ ...base, balance: "0" })).toThrow();
  });
  it("rejects conflicting duplicates and out-of-month records", () => {
    expect(() =>
      aggregateWave({ ...base, records: [record("a"), record("a", "deduct", 2)] }, []),
    ).toThrow();
    expect(() =>
      aggregateWave({ ...base, records: [{ ...record("a"), at: "2026-09-01T00:00:00Z" }] }, []),
    ).toThrow();
  });
  it("uses German calendar days across DST", () => {
    const r = aggregateWave(
      { ...base, records: [{ ...record("a"), at: "2026-10-24T22:30:00Z" }] },
      [],
    );
    expect(r.daily["2026-10-25"]).toBe(1.3);
  });
});
