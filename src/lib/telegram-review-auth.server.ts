import { createHmac, timingSafeEqual } from "node:crypto";

/** Only signed Telegram launch data authenticates the owner; URL parameters never do. */
export function verifyReviewLaunch(raw: string, token: string, owner: string, now = Date.now()) {
  if (!raw || raw.length > 12000 || !token.startsWith("8905298936:")) return false;
  try {
    const values = new URLSearchParams(raw);
    const keys = [...values.keys()];
    if (new Set(keys).size !== keys.length) return false;
    const hash = values.get("hash") ?? "";
    if (!/^[a-f0-9]{64}$/.test(hash)) return false;
    values.delete("hash");
    const check = [...values.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");
    const key = createHmac("sha256", "WebAppData").update(token).digest();
    const expected = createHmac("sha256", key).update(check).digest();
    if (!timingSafeEqual(expected, Buffer.from(hash, "hex"))) return false;
    const date = values.get("auth_date") ?? "";
    if (!/^\d{10}$/.test(date)) return false;
    const age = Math.floor(now / 1000) - Number(date);
    if (age < -30 || age > 900) return false;
    const user = JSON.parse(values.get("user") ?? "null");
    return Number.isSafeInteger(user?.id) && String(user.id) === owner && user.is_bot !== true;
  } catch {
    return false;
  }
}
