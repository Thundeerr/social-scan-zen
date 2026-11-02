// UI fixture only. Never imported by the production application or auth routes.
import React from "react";
const id = "11111111-1111-4111-8111-111111111111";
let links = Array.from({ length: 12 }, (_, i) => ({
  id: crypto.randomUUID(),
  slug: (i + 1).toString(16).padStart(32, "0"),
  target: "https://example.com/creator-launch",
  domain: "https://go.example.com",
  active: true,
  campaign_id: id,
  account_id: null,
  recipient_id: null,
  created_at: new Date().toISOString(),
}));
const campaigns = [
  {
    id,
    name: "Creator Launch · November",
    template: "Hallo {{name}}, hier ist dein Link: {{link}}",
    status: "draft",
    link_count: 12,
  },
];
export const useServerFn = (fn: any) => fn;
export const Link = React.forwardRef<HTMLAnchorElement, any>(({ to, children, ...props }, ref) => (
  <a
    ref={ref}
    href={
      "/tests/smartlink-preview/index.html?mode=" +
      (to.endsWith("analytics") ? "analytics" : to.endsWith("campaigns") ? "campaigns" : "links")
    }
    {...props}
  >
    {children}
  </a>
));
export async function smartlinkFn({ data: d }: any) {
  if (d.action === "overview")
    return {
      campaigns,
      accounts: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          name: "instascanner_demo",
          status: "connected",
        },
      ],
      domains: ["https://go.example.com"],
      trackingReady: true,
    };
  if (d.action === "links")
    return {
      total: links.length,
      items: links
        .filter((l) => l.slug.includes(d.search) || l.target.includes(d.search))
        .slice(d.offset, d.offset + 100),
    };
  if (d.action === "recipients") return { total: 0, items: [] };
  if (d.action === "analytics")
    return {
      total: 1428,
      human: 1092,
      bots: 306,
      unknown: 30,
      unique: 864,
      unidentified: 14,
      timeline: [
        ["2026-10-27", 84, 65],
        ["2026-10-28", 152, 124],
        ["2026-10-29", 132, 102],
        ["2026-10-30", 246, 185],
        ["2026-10-31", 208, 158],
        ["2026-11-01", 284, 216],
        ["2026-11-02", 322, 242],
      ].map(([day, total, human]) => ({ day, total, human })),
      countries: [
        { label: "DE", count: 978 },
        { label: "AT", count: 186 },
        { label: "CH", count: 142 },
        { label: "ZZ", count: 122 },
      ],
      devices: [
        { label: "mobile", count: 1180 },
        { label: "desktop", count: 205 },
        { label: "tablet", count: 43 },
      ],
      referrers: [
        { label: "instagram.com", count: 841 },
        { label: "direct", count: 587 },
      ],
      top: links
        .slice(0, 5)
        .map((l, i) => ({ link_id: l.id, slug: l.slug, total: 120 - i * 15, human: 98 - i * 12 })),
      campaigns: [{ campaign_id: id, name: campaigns[0].name, total: 1428, human: 1092 }],
    };
  if (d.action === "generate") {
    links = Array.from({ length: d.count }, () => ({
      id: crypto.randomUUID(),
      slug: crypto.randomUUID().replaceAll("-", ""),
      target: d.target,
      domain: d.domain,
      active: true,
      campaign_id: d.campaign,
      account_id: d.account,
      recipient_id: null,
      created_at: new Date().toISOString(),
    }));
    campaigns[0].link_count = links.length;
    return { count: links.length };
  }
  if (d.action === "update_links") {
    links = links.map((l) =>
      d.ids.includes(l.id)
        ? {
            ...l,
            ...(d.active === undefined ? {} : { active: d.active }),
            ...(d.target ? { target: d.target } : {}),
          }
        : l,
    );
    return { ok: true };
  }
  throw Error("Nicht im UI-Test simuliert.");
}
