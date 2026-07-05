import { useSyncExternalStore, useEffect } from "react";
import { scannerActivity, scannerHealth, kpis } from "./mock-data";

export type SimEvent = {
  id: number;
  time: string;
  label: string;
  kind: "info" | "success" | "muted";
};

type State = {
  events: SimEvent[];
  isScanning: boolean;
  newPostsToday: number;
  queueSize: number;
  requests: number;
  successRate: number;
  avgResponse: number;
  lastScanAt: number | null; // epoch ms
  nowTick: number; // updated periodically so "X min ago" refreshes
};

let eid = 0;
const mkEvent = (label: string, kind: SimEvent["kind"]): SimEvent => {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return { id: ++eid, time: `${hh}:${mm}`, label, kind };
};

// Seed with the static mock events so SSR + first paint match.
const seedEvents: SimEvent[] = scannerActivity.map((e, i) => ({
  id: -1 - i,
  time: e.time,
  label: e.label,
  kind: (e.kind ?? "muted") as SimEvent["kind"],
}));

let state: State = {
  events: seedEvents,
  isScanning: false,
  newPostsToday: kpis.newPostsToday,
  queueSize: scannerHealth.queueSize,
  requests: scannerHealth.requests,
  successRate: scannerHealth.successRate,
  avgResponse: scannerHealth.avgResponse,
  lastScanAt: null,
  nowTick: 0,
};

const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const emit = () => {
  state = { ...state };
  listeners.forEach((l) => l());
};
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

const pushEvent = (label: string, kind: SimEvent["kind"]) => {
  const next = [mkEvent(label, kind), ...state.events].slice(0, 12);
  state = { ...state, events: next };
  listeners.forEach((l) => l());
};

const BRANDS = [
  "nike", "adidas", "apple", "spacex", "natgeo", "chanelofficial",
  "gucci", "prada", "louisvuitton", "ferrari", "porsche", "bmw",
  "patagonia", "arcteryx", "off____white", "stussy", "kithnyc", "ssense",
];

const rand = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));

// ---- Simulation loop ----

let running = false;
let timeouts: ReturnType<typeof setTimeout>[] = [];
const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(() => resolve(), ms);
    timeouts.push(t);
  });

async function runScanCycle() {
  const total = 247;
  set({
    isScanning: true,
    queueSize: total,
  });
  pushEvent(`Started scan · ${total} accounts`, "info");
  await wait(900);

  let processed = 0;
  let foundThisScan = 0;
  const steps = 9;
  for (let i = 0; i < steps; i++) {
    if (!running) return;
    const batch = Math.ceil(total / steps) + rand(-3, 3);
    processed += batch;
    const brand = BRANDS[rand(0, BRANDS.length - 1)];
    const found = Math.random() < 0.45 ? rand(1, 3) : 0;
    foundThisScan += found;
    set({
      queueSize: Math.max(0, total - processed),
      requests: state.requests + rand(18, 42),
      newPostsToday: state.newPostsToday + found,
      avgResponse: Math.max(360, Math.min(480, state.avgResponse + rand(-12, 12))),
    });
    pushEvent(
      found > 0
        ? `Checked @${brand} · ${found} new post${found > 1 ? "s" : ""}`
        : `Checked @${brand} · No new posts`,
      found > 0 ? "info" : "muted",
    );
    await wait(rand(700, 1200));
  }

  if (!running) return;
  set({
    isScanning: false,
    queueSize: 0,
    lastScanAt: Date.now(),
  });
  pushEvent(`Scan complete · ${foundThisScan} new post${foundThisScan === 1 ? "" : "s"}`, "success");
}

async function loop() {
  while (running) {
    await runScanCycle();
    if (!running) break;
    await wait(12000); // idle between scans
  }
}

let nowInterval: ReturnType<typeof setInterval> | null = null;
let refCount = 0;

function start() {
  refCount++;
  if (refCount > 1) return;
  running = true;
  loop();
  nowInterval = setInterval(() => {
    state = { ...state, nowTick: state.nowTick + 1 };
    listeners.forEach((l) => l());
  }, 5000);
}

function stop() {
  refCount = Math.max(0, refCount - 1);
  if (refCount > 0) return;
  running = false;
  timeouts.forEach(clearTimeout);
  timeouts = [];
  if (nowInterval) clearInterval(nowInterval);
  nowInterval = null;
}

const getSnapshot = () => state;
const getServerSnapshot = () => state;

export function useScanSim() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Mount once at the app shell to keep the simulator running. */
export function useScanSimulator() {
  useEffect(() => {
    start();
    return () => stop();
  }, []);
}

export function formatLastScan(state: State): string {
  if (state.lastScanAt == null) return "just now";
  const diff = Math.max(0, Date.now() - state.lastScanAt);
  const s = Math.floor(diff / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return `${h} hr ago`;
}
