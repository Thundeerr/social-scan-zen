import { z } from "zod";

// Only public HTTPS destinations. No target fetch is performed by the redirector.
export function destination(value: string): string {
  const u = new URL(value);
  const h = u.hostname.toLowerCase();
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    (u.port && u.port !== "443") ||
    !h.includes(".") ||
    h.endsWith(".") ||
    /[[\]:]/.test(h) ||
    /^\d+(\.\d+){3}$/.test(h) ||
    /(^|\.)(localhost|local|internal|test|invalid)$/.test(h)
  )
    throw new Error("Öffentliche HTTPS-Zieladresse erforderlich.");
  return u.href;
}
const url = z
  .string()
  .trim()
  .max(2048)
  .transform((v, ctx) => {
    try {
      return destination(v);
    } catch {
      ctx.addIssue({ code: "custom", message: "Bitte eine öffentliche HTTPS-URL eingeben." });
      return z.NEVER;
    }
  });
const uuid = z.string().uuid();
const filter = z.object({
  campaign: uuid.optional(),
  account: uuid.optional(),
  link: uuid.optional(),
  days: z.number().int().min(1).max(30).default(7),
  device: z.enum(["desktop", "mobile", "tablet", "unknown"]).optional(),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
});
export const smartlinkAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("overview") }),
  z.object({ action: z.literal("provider_stats"), filter }),
  z.object({ action: z.literal("retry_provider"), provider: z.enum(["bitly", "tinyurl"]) }),
  z.object({ action: z.literal("process_provider"), provider: z.enum(["bitly", "tinyurl"]) }),
  z.object({
    action: z.literal("create_campaign"),
    name: z.string().trim().min(1).max(120),
    template: z.string().max(2000).default("Hallo {{name}}, hier ist dein Link: {{link}}"),
  }),
  z.object({
    action: z.literal("campaign_update"),
    id: uuid,
    name: z.string().trim().min(1).max(120),
    template: z.string().max(2000),
    status: z.enum(["draft", "active", "paused", "archived"]),
  }),
  z.object({
    action: z.literal("generate"),
    campaign: uuid,
    target: url,
    domain: z.string().url().max(255),
    count: z.number().int().min(1).max(1000),
    request_id: uuid,
    providers: z
      .array(z.enum(["instascanner", "bitly", "tinyurl"]))
      .min(1)
      .max(3)
      .refine((v) => new Set(v).size === v.length)
      .default(["instascanner"]),
    account: uuid.nullable().default(null),
  }),
  z.object({
    action: z.literal("links"),
    campaign: uuid.optional(),
    search: z.string().max(120).default(""),
    offset: z.number().int().min(0).max(100000).default(0),
    sort: z.enum(["newest", "oldest"]).default("newest"),
  }),
  z.object({
    action: z.literal("update_links"),
    ids: z.array(uuid).min(1).max(1000),
    active: z.boolean().optional(),
    target: url.optional(),
    account: uuid.nullable().optional(),
    recipient: uuid.nullable().optional(),
  }),
  z.object({ action: z.literal("analytics"), filter }),
  z.object({
    action: z.literal("recipients"),
    campaign: uuid,
    offset: z.number().int().min(0).max(100000).default(0),
  }),
  z.object({
    action: z.literal("import_recipients"),
    campaign: uuid,
    recipients: z
      .array(
        z.object({
          handle: z
            .string()
            .trim()
            .regex(/^@?[a-zA-Z0-9._]{1,30}$/),
          name: z.string().trim().max(100),
          consent: z.enum(["unknown", "granted", "revoked"]),
          evidence: z.string().max(500).default(""),
        }),
      )
      .min(1)
      .max(1000),
  }),
  z.object({
    action: z.literal("suppress"),
    handle: z
      .string()
      .trim()
      .regex(/^@?[a-zA-Z0-9._]{1,30}$/),
  }),
  z.object({ action: z.literal("drafts"), campaign: uuid }),
  z.object({ action: z.literal("assign_recipients"), campaign: uuid }),
]);
export type SmartlinkAction = z.infer<typeof smartlinkAction>;

// A missing pseudonym is missing coverage, never evidence of zero visitors.
// These hashes identify visitor-days within campaigns, not individual people.
export function visitorEstimate(summary: { human: number; unique: number; unidentified?: number }) {
  const { human, unique, unidentified } = summary;
  const count = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) >= 0;
  if (
    !count(human) ||
    !count(unique) ||
    !count(unidentified) ||
    unidentified > human ||
    unique > human - unidentified ||
    (human > unidentified && unique === 0)
  ) {
    return {
      state: "unavailable" as const,
      value: "Nicht verfügbar",
      hint: "Besucherabdeckung unbekannt.",
    };
  }
  if (human > 0 && unidentified === human) {
    return {
      state: "unavailable" as const,
      value: "Nicht verfügbar",
      hint: `${human} menschliche Aufrufe ohne Besucherkennung.`,
    };
  }
  if (unidentified > 0) {
    return {
      state: "partial" as const,
      value: `≥ ${unique}`,
      hint: `Teilabdeckung: ${human - unidentified} von ${human} menschlichen Aufrufen; Besucher-Tage je Kampagne.`,
    };
  }
  return {
    state: "complete" as const,
    value: unique,
    hint: "Geschätzte Besucher-Tage je Kampagne.",
  };
}

export function classifyHit(request: Request) {
  const ua = (request.headers.get("user-agent") || "").slice(0, 1000);
  const preview =
    request.method === "HEAD" ||
    /preview|prefetch/i.test(
      request.headers.get("purpose") || request.headers.get("sec-purpose") || "",
    ) ||
    /facebookexternalhit|Facebot|meta-external|WhatsApp|TelegramBot|Twitterbot|Slackbot|Discordbot|LinkedInBot/i.test(
      ua,
    );
  const kind = preview
    ? "preview"
    : /bot|crawler|spider|curl|wget|python|headless|monitor/i.test(ua)
      ? "bot"
      : /Mozilla\//.test(ua)
        ? "human"
        : "unknown";
  const device = /iPad|Tablet/i.test(ua)
    ? "tablet"
    : /Mobi|Android|iPhone/i.test(ua)
      ? "mobile"
      : /Windows|Macintosh|X11|Linux/i.test(ua)
        ? "desktop"
        : "unknown";
  let referrer = "direct";
  try {
    const u = new URL(request.headers.get("referer") || "");
    if (["http:", "https:"].includes(u.protocol)) referrer = u.hostname.slice(0, 253);
  } catch {
    /* no referrer */
  }
  return { kind, device, referrer };
}
export function csv(rows: Record<string, unknown>[], columns: string[]) {
  const cell = (v: unknown) => {
    let s = String(v ?? "");
    if (/^[\s]*[=+@\-\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  return (
    "\uFEFF" +
    [
      columns.map(cell).join(","),
      ...rows.map((r) => columns.map((c) => cell(r[c])).join(",")),
    ].join("\r\n")
  );
}
export function renderDraft(template: string, name: string, link: string) {
  return template.replace(/\{\{(name|link)\}\}/g, (_, key) => (key === "name" ? name : link));
}
