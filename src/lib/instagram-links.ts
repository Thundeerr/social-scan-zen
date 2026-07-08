/** Canonical Instagram deep-link helpers. Keep in sync across all UI surfaces. */

const LOCATION_ID_RE = /^\d{3,20}$/;
const USERNAME_RE = /^[A-Za-z0-9._]{1,30}$/;

export function instagramLocationUrl(locationId: string | null | undefined): string | null {
  if (!locationId) return null;
  const trimmed = String(locationId).trim();
  if (!LOCATION_ID_RE.test(trimmed)) return null;
  return `https://www.instagram.com/explore/locations/${trimmed}/`;
}

export function instagramProfileUrl(username: string | null | undefined): string | null {
  if (!username) return null;
  const trimmed = String(username).trim().replace(/^@/, "");
  if (!USERNAME_RE.test(trimmed)) return null;
  return `https://www.instagram.com/${trimmed}/`;
}
