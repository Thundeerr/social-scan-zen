import { useSyncExternalStore, useEffect } from "react";

/**
 * Ordered list of currently visible asset IDs on the active view.
 * Routes register their filtered list via `useRegisterVisibleAssets`.
 * Global hotkeys (J/K/A/D/I/R/F) act on `selectedId`.
 */
type State = {
  ids: string[];
  selectedId: string | null;
};

let state: State = { ids: [], selectedId: null };
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getSnapshot = () => state;
const getServerSnapshot = () => ({ ids: [], selectedId: null });

export function useSelection() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function setVisibleAssets(ids: string[]) {
  const same =
    ids.length === state.ids.length && ids.every((id, i) => id === state.ids[i]);
  const stillValid =
    state.selectedId != null && ids.includes(state.selectedId);
  const nextSelected = stillValid ? state.selectedId : ids[0] ?? null;
  if (same && nextSelected === state.selectedId) return;
  state = { ids, selectedId: nextSelected };
  emit();
}

export function selectAsset(id: string | null) {
  if (state.selectedId === id) return;
  state = { ...state, selectedId: id };
  emit();
}

export function moveSelection(delta: 1 | -1) {
  const { ids, selectedId } = state;
  if (!ids.length) return;
  const idx = selectedId ? ids.indexOf(selectedId) : -1;
  const nextIdx =
    idx === -1
      ? delta > 0
        ? 0
        : ids.length - 1
      : Math.max(0, Math.min(ids.length - 1, idx + delta));
  const nextId = ids[nextIdx];
  if (nextId === selectedId) return;
  state = { ...state, selectedId: nextId };
  emit();
}

/** Route hook — publishes the current visible list. */
export function useRegisterVisibleAssets(ids: string[]) {
  // stable-ish key; component re-runs the effect when the list changes.
  const key = ids.join("|");
  useEffect(() => {
    setVisibleAssets(ids);
    return () => {
      // when the view unmounts, clear so hotkeys stop firing against stale ids
      setVisibleAssets([]);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
