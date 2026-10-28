import { z } from "zod";
import { berlinTime } from "./business-report";
export const waveRecord = z.object({
  id: z.string().min(1).max(100),
  type: z.string().min(1).max(50),
  usd: z.number().finite().nonnegative().max(1000000),
  at: z.string().datetime({ offset: true }),
  task: z.string().max(100).nullable(),
});
export const wavePayload = z
  .object({
    month: z.string().regex(/^\d{4}-\d{2}$/),
    observed: z.string().datetime({ offset: true }),
    balance: z.number().finite(),
    records: z.array(waveRecord).max(10000),
  })
  .strict();
export type WavePayload = z.infer<typeof wavePayload>;
export function aggregateWave(
  payload: WavePayload,
  jobs: { provider_id: string | null; model: string }[],
) {
  const assignment = new Map<string, Set<string>>();
  for (const j of jobs)
    if (j.provider_id) {
      const models = assignment.get(j.provider_id) ?? new Set<string>();
      models.add(j.model);
      assignment.set(j.provider_id, models);
    }
  const totals = { kiikii: 0, tuuva: 0, unassigned: 0, charged: 0, refunded: 0, unknown: 0 };
  const daily: Record<string, number> = {};
  const tasks = {
    kiikii: new Set<string>(),
    tuuva: new Set<string>(),
    unassigned: new Set<string>(),
  };
  const seen = new Map<string, string>();
  for (const r of payload.records) {
    const serialized = JSON.stringify(r);
    if (seen.has(r.id)) {
      if (seen.get(r.id) !== serialized) throw Error("Widersprüchliche Abrechnung.");
      continue;
    }
    seen.set(r.id, serialized);
    const day = berlinTime(new Date(r.at)).day;
    if (!day.startsWith(payload.month)) throw Error("Abrechnung außerhalb des Monats.");
    // Keep fractional cents until display; never infer refund from prediction failure.
    const amount = Math.round(r.usd * 1e6);
    if (!["deduct", "refund"].includes(r.type)) {
      totals.unknown++;
      continue;
    }
    if (r.type === "deduct") totals.charged += amount;
    else totals.refunded += amount;
    const signed = r.type === "refund" ? -amount : amount;
    const models = r.task ? assignment.get(r.task) : undefined;
    const model = models?.size === 1 ? [...models][0] : null;
    const bucket = model === "kiikii" || model === "tuuva" ? model : "unassigned";
    totals[bucket] += signed;
    if (r.type === "deduct" && r.task) tasks[bucket].add(r.task);
    daily[day] = (daily[day] ?? 0) + signed;
  }
  return {
    month: payload.month,
    observed: payload.observed,
    balance: payload.balance,
    kiikii: totals.kiikii / 1e6,
    tuuva: totals.tuuva / 1e6,
    unassigned: totals.unassigned / 1e6,
    charged: totals.charged / 1e6,
    refunded: totals.refunded / 1e6,
    net: (totals.charged - totals.refunded) / 1e6,
    unknownTypes: totals.unknown,
    recordCount: seen.size,
    tasks: {
      kiikii: tasks.kiikii.size,
      tuuva: tasks.tuuva.size,
      unassigned: tasks.unassigned.size,
    },
    daily: Object.fromEntries(Object.entries(daily).map(([k, v]) => [k, v / 1e6])),
  };
}
export type WaveReport = ReturnType<typeof aggregateWave>;
export function generationRunRate(report: WaveReport) {
  // Calendar days include the partially observed current day. No assumption of equal character output.
  const day = berlinTime(new Date(report.observed)).day;
  if (!day.startsWith(report.month)) return null;
  const days = Number(day.slice(8));
  const factor = 30 / days;
  return {
    days,
    kiikii: report.kiikii * factor,
    tuuva: report.tuuva * factor,
    unassigned: report.unassigned * factor,
    total: report.net * factor,
  };
}
