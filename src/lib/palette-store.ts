import { useSyncExternalStore } from "react";

/**
 * Command palette open/close store. Kept outside React so any hotkey handler
 * (registered once globally) can toggle it without prop drilling.
 */
let open = false;
const listeners = new Set<() => void>();

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getSnapshot = () => open;
const getServerSnapshot = () => false;

export function useCommandPaletteOpen() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function setCommandPaletteOpen(next: boolean) {
  if (open === next) return;
  open = next;
  listeners.forEach((l) => l());
}

export function toggleCommandPalette() {
  setCommandPaletteOpen(!open);
}
