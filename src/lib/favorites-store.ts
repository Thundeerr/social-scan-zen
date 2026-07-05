import { useSyncExternalStore } from "react";

const KEY = "instascanner:favorites:v1";

function load(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

let favorites: Set<string> = load();
const listeners = new Set<() => void>();

const persist = () => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify([...favorites]));
  } catch {
    /* ignore */
  }
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getSnapshot = () => favorites;
const getServerSnapshot: () => Set<string> = (() => {
  const empty = new Set<string>();
  return () => empty;
})();

export function useFavorites() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function isFavorite(id: string) {
  return favorites.has(id);
}

export function toggleFavorite(id: string) {
  const next = new Set(favorites);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  favorites = next;
  persist();
  listeners.forEach((l) => l());
}
