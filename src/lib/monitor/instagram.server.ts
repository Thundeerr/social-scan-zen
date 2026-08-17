/**
 * RapidAPI profile-status client (server-only).
 *
 * Portability contract: this file is the only place that knows about the
 * RapidAPI host for profile status checks. Swap the BASE_URL / headers here to
 * move to another provider without touching pipeline logic.
 */

import { readIsPrivate } from "./transition";

const BASE_URL = "https://instagram-looter2.p.rapidapi.com/profile2";
const HOST = "instagram-looter2.p.rapidapi.com";
const TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 3;

export class MissingApiKeyError extends Error {
  constructor() {
    super("RAPIDAPI_KEY is not configured");
    this.name = "MissingApiKeyError";
  }
}

export type ProfileStatusResult =
  | { ok: true; isPrivate: boolean; excerpt: string }
  | { ok: false; retryable: boolean; error: string; excerpt: string };

function excerptOf(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, 1000);
  } catch {
    return String(value).slice(0, 1000);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchProfileStatus(
  username: string,
  apiKeyOverride?: string,
): Promise<ProfileStatusResult> {
  const apiKey = apiKeyOverride ?? process.env.RAPIDAPI_KEY;
  if (!apiKey) throw new MissingApiKeyError();

  const url = `${BASE_URL}?username=${encodeURIComponent(username)}&fields=status,username,is_private`;
  let lastError = "unknown error";
  let lastExcerpt = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { "x-rapidapi-key": apiKey, "x-rapidapi-host": HOST },
        signal: controller.signal,
      });
      const text = await res.text();
      lastExcerpt = text.slice(0, 1000);

      if (res.status === 429 || res.status >= 500) {
        lastError = `provider responded ${res.status}`;
        if (attempt < MAX_ATTEMPTS) {
          await sleep(500 * 2 ** (attempt - 1));
          continue;
        }
        return { ok: false, retryable: true, error: lastError, excerpt: lastExcerpt };
      }

      if (!res.ok) {
        return {
          ok: false,
          retryable: false,
          error: `provider responded ${res.status}`,
          excerpt: lastExcerpt,
        };
      }

      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        return {
          ok: false,
          retryable: false,
          error: "provider returned non-JSON payload",
          excerpt: lastExcerpt,
        };
      }

      const isPrivate = readIsPrivate(payload);
      if (isPrivate === null) {
        return {
          ok: false,
          retryable: false,
          error: "provider payload contained no is_private flag",
          excerpt: excerptOf(payload),
        };
      }
      return { ok: true, isPrivate, excerpt: excerptOf(payload) };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_ATTEMPTS) {
        await sleep(500 * 2 ** (attempt - 1));
        continue;
      }
      return { ok: false, retryable: true, error: lastError, excerpt: lastExcerpt };
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: false, retryable: true, error: lastError, excerpt: lastExcerpt };
}
