import { z } from "zod";
import { canonicalReel } from "./reel-inbox";
import { MAX_SOURCE_BYTES } from "./generation";

export function reviewVideoReference(id: string, revision: number) {
  return `instascanner:review:${id}:${revision}`;
}

export function parseVideoSource(value: string) {
  const text = value.trim();
  const internal = /^instascanner:review:([^:]+):([1-9]\d*)$/.exec(text);
  if (internal) {
    return {
      kind: "review" as const,
      id: z.string().uuid().parse(internal[1]),
      revision: z.number().int().positive().safe().parse(Number(internal[2])),
    };
  }
  try {
    return { kind: "instagram" as const, url: canonicalReel(text).url };
  } catch {}
  const url = new URL(text);
  // Browser-only downloads: no cookies, redirects or local network addresses.
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !url.hostname.includes(".") ||
    url.hostname.includes(":") ||
    /(?:^|\.)(?:localhost|local|internal)$/.test(url.hostname) ||
    /^(?:\d+\.){3}\d+$/.test(url.hostname)
  ) {
    throw Error(
      "Bitte einen Instagram-Link, öffentlichen HTTPS-Videolink oder kopiertes Video einfügen.",
    );
  }
  return { kind: "video" as const, url: url.href };
}

export async function downloadSourceVideo(url: string, signal: AbortSignal): Promise<File> {
  const response = await fetch(url, {
    signal,
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
  });
  if (!response.ok || !response.body)
    throw Error("Video nicht erreichbar. Link prüfen oder Datei hochladen.");
  if (Number(response.headers.get("content-length")) > MAX_SOURCE_BYTES)
    throw Error("Video ist größer als 40 MB.");
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_SOURCE_BYTES) throw Error("Video ist größer als 40 MB.");
      chunks.push(new Uint8Array(value));
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const file = new File(chunks, "Kopiertes Video.mp4", { type: "video/mp4" });
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (size < 12 || String.fromCharCode(...header.slice(4, 8)) !== "ftyp")
    throw Error("Der Link enthält keine MP4-Datei.");
  return file;
}
