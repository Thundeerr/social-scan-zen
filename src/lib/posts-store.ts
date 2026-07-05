import { useSyncExternalStore } from "react";
import { recentPosts, type Post } from "./mock-data";

type Status = Post["status"];

let posts: Post[] = recentPosts.map((p) => ({ ...p }));
const listeners = new Set<() => void>();

function emit() {
  posts = [...posts];
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function getSnapshot() {
  return posts;
}

export function usePosts() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function setPostStatus(id: string, status: Status) {
  const idx = posts.findIndex((p) => p.id === id);
  if (idx === -1) return;
  posts[idx] = { ...posts[idx], status };
  emit();
}

export const postActions = {
  approve: (id: string) => setPostStatus(id, "approved"),
  ignore: (id: string) => setPostStatus(id, "ignored"),
  download: (id: string) => setPostStatus(id, "downloaded"),
  reset: (id: string) => setPostStatus(id, "new"),
};
