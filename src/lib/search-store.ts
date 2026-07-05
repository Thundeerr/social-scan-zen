import { useSyncExternalStore } from "react";

let q = "";
const listeners = new Set<() => void>();

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getSnapshot = () => q;

export function useGlobalQuery() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function setGlobalQuery(next: string) {
  q = next;
  listeners.forEach((l) => l());
}

export function matchesQuery(
  post: { username: string; caption: string },
  needle: string,
) {
  if (!needle) return true;
  const n = needle.toLowerCase();
  return (
    post.username.toLowerCase().includes(n) ||
    post.caption.toLowerCase().includes(n)
  );
}
