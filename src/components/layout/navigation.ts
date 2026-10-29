import {
  Activity,
  Clapperboard,
  Download,
  Eye,
  Flame,
  Gauge,
  Images,
  Inbox,
  LayoutDashboard,
  MapPin,
  Radar,
  Send,
  Settings,
  Sparkles,
  Users,
  Video,
  type LucideIcon,
} from "lucide-react";

type NavigationItem = { to: string; label: string; icon: LucideIcon };
export type NavigationGroup = {
  id: string;
  label: string;
  defaultOpen: boolean;
  items: NavigationItem[];
};

export const navigationGroups: NavigationGroup[] = [
  {
    id: "daily",
    label: "Your workspace",
    defaultOpen: true,
    items: [
      { to: "/", label: "Overview", icon: LayoutDashboard },
      { to: "/reel-inbox", label: "Reel inbox", icon: Inbox },
      { to: "/generate", label: "Create video", icon: Video },
      { to: "/content-review", label: "Review & publish", icon: Clapperboard },
      { to: "/catalogue", label: "My videos & bundles", icon: Images },
      { to: "/business", label: "Revenue & costs", icon: Gauge },
    ],
  },
  {
    id: "sources",
    label: "Sources & scanner",
    defaultOpen: false,
    items: [
      { to: "/accounts", label: "Tracked accounts", icon: Users },
      { to: "/locations", label: "Tracked locations", icon: MapPin },
      { to: "/assets", label: "Discovered content", icon: Images },
      { to: "/scanner", label: "Scanner", icon: Radar },
      { to: "/downloads", label: "Downloads & archive", icon: Download },
      { to: "/monitor", label: "Account status", icon: Eye },
      { to: "/discovery", label: "Discover accounts", icon: Sparkles },
      { to: "/discovery/analytics", label: "Discovery analytics", icon: Gauge },
    ],
  },
  {
    id: "followerstar",
    label: "FollowerStar",
    defaultOpen: false,
    items: [{ to: "/publisher", label: "FollowerStar posts", icon: Clapperboard }],
  },
  {
    id: "tools",
    label: "Settings & tools",
    defaultOpen: false,
    items: [
      { to: "/settings", label: "Settings", icon: Settings },
      { to: "/telegram", label: "Telegram", icon: Send },
      { to: "/activity", label: "Activity", icon: Activity },
      { to: "/burn", label: "API usage", icon: Flame },
    ],
  },
];

export function getActiveNavigationItem(pathname: string) {
  return navigationGroups
    .flatMap((group) => group.items)
    .reduce<NavigationItem | undefined>((active, item) => {
      const matches =
        item.to === "/"
          ? pathname === "/"
          : pathname === item.to || pathname.startsWith(`${item.to}/`);
      return matches && (!active || item.to.length > active.to.length) ? item : active;
    }, undefined);
}
