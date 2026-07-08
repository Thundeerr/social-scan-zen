/** Canonical Instagram deep-link helpers. Keep in sync across all UI surfaces. */
export function instagramLocationUrl(locationId: string): string {
  return `https://www.instagram.com/explore/locations/${locationId}/`;
}

export function instagramProfileUrl(username: string): string {
  return `https://www.instagram.com/${username}/`;
}
