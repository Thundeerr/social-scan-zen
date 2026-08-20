export function isAllowedFollowerStarStoryUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      (url.hostname === "followerstar.com" || url.hostname.endsWith(".followerstar.com"))
    );
  } catch {
    return false;
  }
}

export function withInstagramStoryTracking(value: string, postKey: string) {
  const url = new URL(value);
  url.searchParams.set("utm_source", "instagram");
  url.searchParams.set("utm_medium", "story");
  url.searchParams.set("utm_campaign", postKey);
  url.searchParams.set("utm_content", "link_sticker");
  return url.toString();
}
