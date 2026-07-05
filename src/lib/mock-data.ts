export type Account = {
  id: string;
  username: string;
  displayName: string;
  status: "active" | "paused";
  lastScan: string;
  assetsToday: number;
  followers: string;
};

export type Asset = {
  id: string;
  username: string;
  detectedAt: string;
  caption: string;
  thumbnail: string;
  video?: string;
  avatar: string;
  status: "new" | "approved" | "ignored" | "downloaded";
  day: "today" | "yesterday";
  likes: string;
};

export type ActivityEvent = {
  time: string;
  label: string;
  kind?: "info" | "success" | "muted";
};

const seed = (s: string) => `https://picsum.photos/seed/${s}/800/800`;
const avatar = (s: string) => `https://i.pravatar.cc/120?u=${s}`;

export const kpis = {
  trackedAccounts: 247,
  newAssetsToday: 34,
  lastScan: "12 min ago",
  scannerStatus: "Running",
  apiProvider: "Instagram Looter",
};

export const scannerHealth = {
  queueSize: 12,
  requests: 1284,
  successRate: 99.2,
  avgResponse: 412,
  nextScan: "in 3 min",
};

const brands = [
  ["nike", "Nike", "312M"],
  ["adidas", "adidas", "28.5M"],
  ["apple", "Apple", "34.2M"],
  ["spacex", "SpaceX", "9.1M"],
  ["natgeo", "National Geographic", "281M"],
  ["chanelofficial", "Chanel", "58.7M"],
  ["gucci", "Gucci", "51.3M"],
  ["prada", "Prada", "29.8M"],
  ["louisvuitton", "Louis Vuitton", "54.6M"],
  ["balenciaga", "Balenciaga", "16.2M"],
  ["ferrari", "Ferrari", "45.9M"],
  ["porsche", "Porsche", "34.1M"],
  ["bmw", "BMW", "36.5M"],
  ["mercedesbenz", "Mercedes-Benz", "31.2M"],
  ["rimac_official", "Rimac Automobili", "1.2M"],
  ["patagonia", "Patagonia", "5.4M"],
  ["arcteryx", "Arc'teryx", "1.9M"],
  ["carhartt", "Carhartt", "1.8M"],
  ["off____white", "Off-White", "13.8M"],
  ["stussy", "Stüssy", "5.6M"],
  ["aimeleondore", "Aimé Leon Dore", "1.1M"],
  ["kithnyc", "Kith", "1.9M"],
  ["needlesofficial", "Needles", "412K"],
  ["ssense", "SSENSE", "4.1M"],
] as const;

export const trackedAccounts: Account[] = brands.map(([u, d, f], i) => ({
  id: String(i + 1),
  username: u,
  displayName: d,
  status: i % 7 === 3 ? "paused" : "active",
  lastScan: [
    "just now", "2 min ago", "5 min ago", "12 min ago", "18 min ago",
    "23 min ago", "31 min ago", "44 min ago", "1 hr ago", "2 hr ago",
  ][i % 10],
  assetsToday: [0, 1, 2, 0, 3, 0, 1, 4, 0, 2, 1, 0][i % 12],
  followers: f,
}));

const captions = [
  "Just landed the new campaign. Behind the scenes soon.",
  "New drop this Friday. Set your alarms.",
  "A quiet morning at the studio. New collection incoming.",
  "Nothing beats a run at sunrise. #justdoit",
  "Limited edition. 500 pieces worldwide.",
  "In collaboration with our friends in Tokyo.",
  "The archive lives on. Rediscovering 1997.",
  "Track weather updates from Cape Canaveral tonight.",
  "Handcrafted in Italy. Available now in select boutiques.",
  "Our team on the road for the summer tour.",
  "Behind every stitch — three decades of craft.",
  "Weekend inspiration from the Dolomites.",
];

export const recentAssets: Asset[] = Array.from({ length: 24 }).map((_, i) => {
  const [u] = brands[i % brands.length];
  return {
    id: `a${i + 1}`,
    username: u,
    detectedAt: [
      "2 min ago", "8 min ago", "14 min ago", "22 min ago", "38 min ago",
      "1 hr ago", "2 hr ago", "3 hr ago",
    ][i % 8],
    caption: captions[i % captions.length],
    thumbnail: seed(`${u}-${i}`),
    avatar: avatar(u),
    status: (["new", "new", "new", "approved", "ignored", "downloaded"] as const)[i % 6],
    day: i < 14 ? "today" : "yesterday",
    likes: `${((i * 37 + 23) % 480 + 20)}K`,
  };
});

export const scannerActivity: ActivityEvent[] = [
  { time: "14:06", label: "Scan complete · 34 new assets", kind: "success" },
  { time: "14:05", label: "Checked @adidas · No new assets", kind: "muted" },
  { time: "14:04", label: "Checked @nike · 2 new assets", kind: "info" },
  { time: "14:03", label: "Checked @patagonia · 1 new asset", kind: "info" },
  { time: "14:03", label: "Checked @gucci · No new assets", kind: "muted" },
  { time: "14:02", label: "Checked @apple · No new assets", kind: "muted" },
  { time: "14:02", label: "Started scan · 247 accounts", kind: "info" },
  { time: "13:47", label: "Previous scan complete · 12 new assets", kind: "success" },
];

export const getAvatar = avatar;
