/**
 * THE single provider boundary for outbound monitor actions.
 *
 * Nothing else in the codebase may talk to an order provider. Everything —
 * buttons, queue processing, DB records, UI states — hangs off
 * `dispatchExternalAction(actionId)`.
 *
 * Portability contract: swapping providers means editing only this file.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";

const DEFAULT_BASE_URL = "https://justanotherpanel.com/api/v2";
const TIMEOUT_MS = 30_000;

export type ExternalActionStatus = "not_configured" | "completed" | "failed" | "unknown_outcome";

export type ExternalActionResult = {
  ok: boolean;
  status: ExternalActionStatus | "skipped";
  message?: string;
  providerReference?: string | null;
};

export type ExternalActionRequest = {
  actionId: string;
  accountId: string;
  eventId: string;
  templateId: string;
  target: string;
  quantity: number | null;
  serviceReference: string | null;
  baseUrl: string;
  attempt: number;
  requestedAt: string;
};

function excerpt(value: unknown) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return { raw: String(value).slice(0, 1000) };
  }
}

export async function dispatchExternalAction(actionId: string): Promise<ExternalActionResult> {
  const db = supabaseAdmin;

  const { data: action, error } = await db
    .from("monitor_actions")
    .select("*")
    .eq("id", actionId)
    .maybeSingle();

  if (error || !action) {
    return { ok: false, status: "failed", message: "action not found" };
  }

  // Atomic claim via compare-and-swap on attempt_count: only one concurrent
  // caller can move the row into `processing`.
  const { data: claimed } = await db
    .from("monitor_actions")
    .update({ status: "processing", attempt_count: action.attempt_count + 1 })
    .eq("id", actionId)
    .eq("attempt_count", action.attempt_count)
    .in("status", ["queued", "failed", "not_configured", "unknown_outcome"])
    .select("*")
    .maybeSingle();

  if (!claimed) {
    return { ok: false, status: "skipped", message: "action already in flight" };
  }

  const { data: account } = await db
    .from("monitor_accounts")
    .select("user_id")
    .eq("id", claimed.account_id)
    .maybeSingle();

  const { data: settings } = account
    ? await db
        .from("monitor_settings")
        .select("adapter_base_url")
        .eq("user_id", account.user_id)
        .maybeSingle()
    : { data: null };

  const request: ExternalActionRequest = {
    actionId: claimed.id,
    accountId: claimed.account_id,
    eventId: claimed.event_id,
    templateId: claimed.template_id,
    target: claimed.target,
    quantity: claimed.quantity,
    serviceReference: claimed.service_reference,
    baseUrl: settings?.adapter_base_url || DEFAULT_BASE_URL,
    attempt: claimed.attempt_count,
    requestedAt: new Date().toISOString(),
  };

  async function finish(
    status: ExternalActionStatus,
    message?: string,
    providerReference?: string | null,
    responseExcerpt?: unknown,
  ): Promise<ExternalActionResult> {
    await db
      .from("monitor_actions")
      .update({
        status,
        error_message: message ?? null,
        provider_reference: status === "completed" ? (providerReference ?? null) : null,
        request_excerpt: excerpt({ ...request, apiKey: undefined }),
        response_excerpt: responseExcerpt === undefined ? null : excerpt(responseExcerpt),
      })
      .eq("id", actionId);
    return {
      ok: status === "completed",
      status,
      message,
      providerReference: providerReference ?? null,
    };
  }

  const apiKey = process.env.JAP_API_KEY;
  const quantity = Number(request.quantity);
  if (!apiKey) {
    return finish("not_configured", "Order provider API key is not configured");
  }
  if (!request.serviceReference || !Number.isFinite(quantity) || quantity < 1) {
    return finish("not_configured", "Template is missing a service reference or a valid quantity");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  let text: string;
  try {
    res = await fetch(request.baseUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        key: apiKey,
        action: "add",
        service: request.serviceReference,
        link: request.target,
        quantity: String(quantity),
      }).toString(),
      signal: controller.signal,
    });
    text = await res.text();
  } catch (err) {
    // The order may well exist on the provider side — never auto-complete and
    // never auto-fail a network error.
    const message = err instanceof Error ? err.message : String(err);
    return finish("unknown_outcome", `Network error: ${message}`);
  } finally {
    clearTimeout(timer);
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return finish(
      res.ok ? "unknown_outcome" : "failed",
      `Unparsable provider response (HTTP ${res.status})`,
      null,
      { raw: text.slice(0, 1000) },
    );
  }

  if (payload.error) {
    return finish("failed", String(payload.error), null, payload);
  }

  const order = payload.order;
  if (order === undefined || order === null || String(order).trim() === "") {
    return finish(
      res.ok ? "unknown_outcome" : "failed",
      `Provider response contained no order id (HTTP ${res.status})`,
      null,
      payload,
    );
  }

  return finish("completed", undefined, String(order), payload);
}

export function isActionAdapterConfigured(): boolean {
  return Boolean(process.env.JAP_API_KEY);
}
