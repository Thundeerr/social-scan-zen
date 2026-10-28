import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { aggregateWave, wavePayload, type WaveReport } from "./wavespeed-analytics";
import { berlinTime } from "./business-report";
const db = () => supabaseAdmin as SupabaseClient;
const OWNER = "e4ee414f-fbb6-4f82-b5fc-22d74ed6b3cc";
function checked<T>(r: { data: T; error: unknown }): T {
  if (r.error) throw Error("WaveSpeed-Zahlen nicht erreichbar.");
  return r.data;
}
export async function waveStatus(user: string) {
  if (user !== OWNER) return null;
  const s = checked(
    await db()
      .from("wavespeed_analytics_state")
      .select("last_synced_at,last_attempt_at,last_error,requested_at,report,ledger")
      .eq("user_id", user)
      .maybeSingle(),
  );
  const original = s?.report as WaveReport | null;
  const report =
    original && s?.ledger
      ? aggregateWave(
          {
            month: original.month,
            observed: original.observed,
            balance: original.balance,
            records: s.ledger,
          },
          await waveAssignments(user),
        )
      : original;
  return s
    ? {
        lastSynced: s.last_synced_at,
        error: s.last_error,
        pending: !s.last_synced_at || s.requested_at > s.last_synced_at,
        report,
      }
    : null;
}
async function waveAssignments(user: string) {
  const jobs: { provider_id: string | null; model: string }[] = [];
  for (const table of ["model_pipeline_jobs", "wavespeed_task_attributions"]) {
    for (let from = 0; from < 100000; from += 1000) {
      const batch = checked(
        await db()
          .from(table)
          .select("provider_id,model")
          .eq("user_id", user)
          .not("provider_id", "is", null)
          .order("provider_id")
          .order("model")
          .range(from, from + 999),
      );
      if (!batch) throw Error("Auftragszuordnung nicht verfügbar.");
      jobs.push(...batch);
      if (batch.length < 1000) break;
      if (from === 99000) throw Error("Too many mappings");
    }
  }
  return jobs;
}
export async function requestWaveSync(user: string) {
  if (user !== OWNER) throw Error("Nur für den Betreiber verfügbar.");
  checked(
    await db()
      .from("wavespeed_analytics_state")
      .upsert({ user_id: user, requested_at: new Date().toISOString() }, { onConflict: "user_id" }),
  );
}
export async function waveCollector(request: Request) {
  const headers = { "cache-control": "no-store" };
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
  const token = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token) return reply({}, 401);
  try {
    const account = checked(
      await db()
        .from("model_pipeline_settings")
        .select("user_id")
        .eq("user_id", OWNER)
        .eq("worker_hash", createHash("sha256").update(token).digest("hex"))
        .maybeSingle(),
    );
    if (!account) return reply({}, 401);
    const now = new Date(),
      local = berlinTime(now);
    if (request.method === "GET") {
      checked(
        await db()
          .from("wavespeed_analytics_state")
          .upsert({ user_id: OWNER }, { onConflict: "user_id", ignoreDuplicates: true }),
      );
      const s = checked(
        await db().from("wavespeed_analytics_state").select("*").eq("user_id", OWNER).single(),
      );
      const daily =
        local.time >= "19:50" &&
        (!s.last_synced_at ||
          berlinTime(new Date(s.last_synced_at)).day !== local.day ||
          berlinTime(new Date(s.last_synced_at)).time < "19:50");
      const needed = !s.last_synced_at || s.requested_at > s.last_synced_at || daily;
      if (!needed) return reply({ needed: false });
      const claim = checked(
        await db()
          .from("wavespeed_analytics_state")
          .update({ last_attempt_at: now.toISOString() })
          .eq("user_id", OWNER)
          .lt("last_attempt_at", new Date(now.getTime() - 600000).toISOString())
          .select("user_id")
          .maybeSingle(),
      );
      return reply({ needed: !!claim });
    }
    const reader = request.body?.getReader();
    if (!reader) return reply({}, 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 3000000) {
        await reader.cancel();
        return reply({}, 413);
      }
      chunks.push(part.value);
    }
    const raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (raw.error === true) {
      checked(
        await db()
          .from("wavespeed_analytics_state")
          .update({
            last_error:
              "WaveSpeed-Abruf fehlgeschlagen. Letzte bestätigte Zahlen bleiben erhalten.",
          })
          .eq("user_id", OWNER),
      );
      return reply({ ok: true });
    }
    const payload = wavePayload.parse(raw);
    if (
      payload.month !== local.day.slice(0, 7) ||
      Math.abs(now.getTime() - Date.parse(payload.observed)) > 15 * 60000
    )
      return reply({}, 400);
    const jobs = await waveAssignments(OWNER);
    const report = aggregateWave(payload, jobs);
    checked(
      await db().from("wavespeed_monthly_reports").upsert(
        {
          user_id: OWNER,
          month: payload.month,
          observed_at: payload.observed,
          report,
          ledger: payload.records,
        },
        { onConflict: "user_id,month" },
      ),
    );
    // One atomic write: partial pagination and failures never replace last good report.
    const saved = checked(
      await db()
        .from("wavespeed_analytics_state")
        .update({
          report,
          ledger: payload.records,
          last_synced_at: payload.observed,
          last_error: null,
        })
        .eq("user_id", OWNER)
        .or(`last_synced_at.is.null,last_synced_at.lt.${payload.observed}`)
        .select("user_id")
        .maybeSingle(),
    );
    return reply({ ok: true, updated: !!saved });
  } catch {
    return reply({ error: "Statistik konnte nicht bestätigt werden." }, 503);
  }
}
