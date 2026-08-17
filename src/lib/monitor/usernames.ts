/**
 * Pure username parsing/normalisation for the monitor bulk import.
 * Browser-safe.
 */

const USERNAME_RE = /^[A-Za-z0-9._]{1,30}$/;

export function extractUsername(raw: string): string {
  let value = (raw ?? "").trim();
  if (!value) return "";
  // strip inline comments
  const hash = value.indexOf("#");
  if (hash === 0) return "";
  if (hash > 0) value = value.slice(0, hash).trim();
  value = value.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  value = value.replace(/^instagram\.com\//i, "");
  value = value.split(/[?#]/)[0];
  value = value.split("/").filter(Boolean)[0] ?? "";
  value = value.replace(/^@+/, "");
  value = value.replace(/^[^A-Za-z0-9._]+|[^A-Za-z0-9._]+$/g, "");
  return value;
}

export function isValidUsername(value: string): boolean {
  if (!USERNAME_RE.test(value)) return false;
  if (value.startsWith(".") || value.endsWith(".")) return false;
  if (value.includes("..")) return false;
  return true;
}

export function normalizeUsername(value: string): string {
  return value.toLowerCase();
}

export type ParsedUsernames = {
  valid: { username: string; normalized: string }[];
  invalid: string[];
  duplicates: string[];
};

export function parseUsernameInput(input: string): ParsedUsernames {
  const tokens = (input ?? "").split(/[\s,;]+/).filter(Boolean);
  const valid: ParsedUsernames["valid"] = [];
  const invalid: string[] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    const username = extractUsername(token);
    if (!username) continue;
    if (!isValidUsername(username)) {
      invalid.push(token);
      continue;
    }
    const normalized = normalizeUsername(username);
    if (seen.has(normalized)) {
      duplicates.push(username);
      continue;
    }
    seen.add(normalized);
    valid.push({ username, normalized });
  }

  return { valid, invalid, duplicates };
}

export function renderTarget(template: string, username: string): string {
  return (template ?? "").replaceAll("{username}", username);
}
