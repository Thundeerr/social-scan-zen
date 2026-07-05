import { useSyncExternalStore } from "react";
import { recentAssets, type Asset } from "./mock-data";

type Status = Asset["status"];

let assets: Asset[] = recentAssets.map((a) => ({ ...a }));
const listeners = new Set<() => void>();

function emit() {
  assets = [...assets];
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function getSnapshot() {
  return assets;
}

export function useAssets() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function setAssetStatus(id: string, status: Status) {
  const idx = assets.findIndex((a) => a.id === id);
  if (idx === -1) return;
  assets[idx] = { ...assets[idx], status };
  emit();
}

export const assetActions = {
  approve: (id: string) => setAssetStatus(id, "approved"),
  ignore: (id: string) => setAssetStatus(id, "ignored"),
  download: (id: string) => setAssetStatus(id, "downloaded"),
  reset: (id: string) => setAssetStatus(id, "new"),
};
