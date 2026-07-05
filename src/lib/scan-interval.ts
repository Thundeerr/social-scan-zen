import { useEffect, useState } from "react";
import { z } from "zod";

// Allowed scan-interval presets (minutes). Kept here so both Settings and
// the Scanner page share one source of truth without a circular dependency.
export const SCAN_INTERVAL_OPTIONS = [
  { value: "240", label: "Every 4 hours", short: "4h" },
  { value: "480", label: "Every 8 hours", short: "8h" },
  { value: "720", label: "Every 12 hours", short: "12h" },
  { value: "1440", label: "Every 24 hours", short: "24h" },
  { value: "2160", label: "Every 36 hours", short: "36h" },
  { value: "4320", label: "Every 72 hours", short: "72h" },
] as const;

export type ScanIntervalValue = (typeof SCAN_INTERVAL_OPTIONS)[number]["value"];

export const scanIntervalSchema = z.enum(
  SCAN_INTERVAL_OPTIONS.map((o) => o.value) as [ScanIntervalValue, ...ScanIntervalValue[]],
  { errorMap: () => ({ message: "Unsupported scan interval" }) },
);

export const DEFAULT_SCAN_INTERVAL: ScanIntervalValue = "480";
const STORAGE_KEY = "instascanner.scanInterval";

function readStored(): ScanIntervalValue {
  if (typeof window === "undefined") return DEFAULT_SCAN_INTERVAL;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  const parsed = scanIntervalSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_SCAN_INTERVAL;
}

// Shared hook — persists to localStorage and syncs across tabs / components.
export function useScanInterval(): [ScanIntervalValue, (v: ScanIntervalValue) => void] {
  const [value, setValue] = useState<ScanIntervalValue>(DEFAULT_SCAN_INTERVAL);

  useEffect(() => {
    setValue(readStored());
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      const parsed = scanIntervalSchema.safeParse(e.newValue);
      if (parsed.success) setValue(parsed.data);
    };
    const onLocal = () => setValue(readStored());
    window.addEventListener("storage", onStorage);
    window.addEventListener("instascanner:scan-interval", onLocal);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("instascanner:scan-interval", onLocal);
    };
  }, []);

  const update = (next: ScanIntervalValue) => {
    setValue(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, next);
      window.dispatchEvent(new Event("instascanner:scan-interval"));
    }
  };

  return [value, update];
}

export function intervalMinutes(v: ScanIntervalValue): number {
  return Number(v);
}

export function intervalShortLabel(v: ScanIntervalValue): string {
  return SCAN_INTERVAL_OPTIONS.find((o) => o.value === v)?.short ?? `${v}m`;
}
