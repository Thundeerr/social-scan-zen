/**
 * Provider-agnostic chat completion adapter — server-only.
 *
 * Every AI call in the app MUST go through this module. Never import
 * provider SDKs or hit provider URLs directly from feature code.
 *
 * Switch providers with env `AI_PROVIDER` — no code changes required:
 *   - `lovable`  (default) → ai.gateway.lovable.dev, LOVABLE_API_KEY
 *   - `openai`             → api.openai.com,       OPENAI_API_KEY
 *   - `gemini`             → generativelanguage.googleapis.com (OpenAI-compat),
 *                            GEMINI_API_KEY
 *
 * All three providers speak OpenAI chat-completions wire format, so the
 * request/response shape is identical. The only per-provider concern is
 * mapping the generic model alias to the provider's model name.
 */

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatCompletionRequest = {
  /** Generic model alias — mapped to the active provider's model name. */
  model: "fast" | "smart" | (string & {});
  messages: ChatMessage[];
  /** OpenAI-format response_format (json_object or json_schema). Optional. */
  response_format?: Record<string, unknown>;
  temperature?: number;
  signal?: AbortSignal;
};

export type ChatCompletionResult =
  | { ok: true; content: string }
  | { ok: false; status: number; error: string };

type Provider = "lovable" | "openai" | "gemini";

function getProvider(): Provider {
  const raw = (process.env.AI_PROVIDER ?? "lovable").toLowerCase();
  if (raw === "openai" || raw === "gemini") return raw;
  return "lovable";
}

/**
 * Map a generic model alias to the active provider's model id.
 * Feature code should pass `"fast"` or `"smart"` — provider-specific
 * names (like `google/gemini-2.5-flash`) still work for backward
 * compatibility but pin the app to whoever ships that name.
 */
function resolveModel(alias: string, provider: Provider): string {
  if (alias === "fast") {
    switch (provider) {
      case "lovable": return "google/gemini-2.5-flash";
      case "openai":  return "gpt-5-mini";
      case "gemini":  return "gemini-2.5-flash";
    }
  }
  if (alias === "smart") {
    switch (provider) {
      case "lovable": return "google/gemini-2.5-pro";
      case "openai":  return "gpt-5";
      case "gemini":  return "gemini-2.5-pro";
    }
  }
  return alias;
}

function endpointFor(provider: Provider): { url: string; auth: string | null } {
  switch (provider) {
    case "lovable":
      return {
        url: "https://ai.gateway.lovable.dev/v1/chat/completions",
        auth: process.env.LOVABLE_API_KEY ?? null,
      };
    case "openai":
      return {
        url: "https://api.openai.com/v1/chat/completions",
        auth: process.env.OPENAI_API_KEY ?? null,
      };
    case "gemini":
      return {
        url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        auth: process.env.GEMINI_API_KEY ?? null,
      };
  }
}

export async function chatCompletion(
  req: ChatCompletionRequest,
): Promise<ChatCompletionResult> {
  const provider = getProvider();
  const { url, auth } = endpointFor(provider);
  if (!auth) {
    return { ok: false, status: 0, error: `${provider} API key is not configured` };
  }

  const body: Record<string, unknown> = {
    model: resolveModel(req.model, provider),
    messages: req.messages,
  };
  if (req.response_format) body.response_format = req.response_format;
  if (req.temperature != null) body.temperature = req.temperature;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth}`,
      },
      body: JSON.stringify(body),
      signal: req.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, status: res.status, error: text.slice(0, 400) };
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return { ok: true, content: json.choices?.[0]?.message?.content ?? "" };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Which provider will be used for the next call — for logs/debug only. */
export function activeAiProvider(): Provider {
  return getProvider();
}
