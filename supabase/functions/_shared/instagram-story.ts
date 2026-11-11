/** Real Story mentions, supported for image and video Stories by Meta since July 2025. */
export function buildStoryMentionFields(username?: string | null): { user_tags?: string } {
  if (username == null || username === "") return {};
  if (!/^[a-zA-Z0-9._]{1,30}$/.test(username)) {
    throw new Error("Instagram Story mention must be a username without @");
  }
  return { user_tags: JSON.stringify([{ username, x: 0.5, y: 0.8 }]) };
}
