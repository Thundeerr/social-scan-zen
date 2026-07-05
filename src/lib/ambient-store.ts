import { useSyncExternalStore } from "react";

// Ambient state — a single-flag signal the background layer reads. When set
// to `calm`, the autonomous network subtly reduces its activity: fewer moving
// particles, softer traces. Nothing turns off — monitoring never stops.

let calm = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function setAmbientCalm(next: boolean) {
  if (calm === next) return;
  calm = next;
  emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
function getSnapshot() {
  return calm;
}

export function useAmbientCalm(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
