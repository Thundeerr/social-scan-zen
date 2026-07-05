import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Send, Loader2, Radar } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/page-header";
import {
  SCAN_INTERVAL_OPTIONS,
  scanIntervalSchema,
  useScanInterval,
} from "@/lib/scan-interval";
import {
  detectTelegramChatIdFn,
  getTelegramPrefsFn,
  saveTelegramPrefsFn,
  sendTelegramTestFn,
} from "@/lib/telegram.functions";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings — InstaScanner" }] }),
  component: SettingsPage,
});


function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 py-5 first:pt-0 last:pb-0 border-b border-border last:border-0">
      <div className="max-w-lg">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
      </div>
      <div className="sm:min-w-[220px] sm:flex sm:justify-end">{children}</div>
    </div>
  );
}

function SettingsPage() {
  const [provider, setProvider] = useState("instagram-looter");
  const [interval, setIntervalValue] = useScanInterval();
  const [telegramNotif, setTelegramNotif] = useState(false);
  const [telegramChatId, setTelegramChatId] = useState("");
  const [desktopNotif, setDesktopNotif] = useState(false);
  const [newOnly, setNewOnly] = useState(true);

  // Persist Telegram notification prefs locally so they survive refresh.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const enabled = window.localStorage.getItem("instascanner.telegramNotif");
    const chat = window.localStorage.getItem("instascanner.telegramChatId");
    if (enabled !== null) setTelegramNotif(enabled === "1");
    if (chat !== null) setTelegramChatId(chat);
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      "instascanner.telegramNotif",
      telegramNotif ? "1" : "0",
    );
  }, [telegramNotif]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("instascanner.telegramChatId", telegramChatId);
  }, [telegramChatId]);

  const handleIntervalChange = (next: string) => {
    const parsed = scanIntervalSchema.safeParse(next);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Unsupported scan interval");
      return;
    }
    setIntervalValue(parsed.data);
  };


  return (
    <div className="p-6 md:p-8 space-y-6">
      <PageHeader
        eyebrow="Operator preferences"
        eyebrowTone="muted"
        eyebrowDot={false}
        title="Settings"
        description="Configure scanner behavior, notifications, and appearance."
      />


      <div className="max-w-3xl space-y-6">
        <section className="soft-shadow rounded-xl border border-border bg-card p-6">
          <h2 className="text-sm font-semibold mb-1">Scanner</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Choose the API provider and how often accounts are polled.
          </p>
          <div className="divide-y divide-border">
            <SettingRow
              title="API Provider"
              description="Backend service used to fetch Instagram data."
            >
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger className="w-full sm:w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="instagram-looter">Instagram Looter</SelectItem>
                  <SelectItem value="rapidapi">RapidAPI</SelectItem>
                  <SelectItem value="custom">Custom Endpoint</SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>
            <SettingRow
              title="Scan Interval"
              description="How frequently the scanner cycles through all tracked accounts."
            >
              <Select value={interval} onValueChange={handleIntervalChange}>
                <SelectTrigger className="w-full sm:w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCAN_INTERVAL_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingRow>
          </div>
        </section>

        <section className="soft-shadow rounded-xl border border-border bg-card p-6">
          <h2 className="text-sm font-semibold mb-1">Notifications</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Choose how you're alerted when new assets are detected.
          </p>
          <div className="divide-y divide-border">
            <SettingRow
              title="Telegram bot"
              description="Route alerts to a Telegram chat. Message @InstaScannerBot with /start, then paste your chat ID here."
            >
              <div className="flex w-full items-center gap-2 sm:w-auto">
                <div className="relative flex-1 sm:w-56 sm:flex-none">
                  <Send className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={telegramChatId}
                    onChange={(e) => setTelegramChatId(e.target.value)}
                    placeholder="Chat ID (e.g. 123456789)"
                    inputMode="numeric"
                    className="h-9 pl-7 text-xs font-mono"
                    disabled={!telegramNotif}
                  />
                </div>
                <Switch
                  checked={telegramNotif}
                  onCheckedChange={(next) => {
                    if (next && !telegramChatId.trim()) {
                      toast.error("Enter a Telegram chat ID first");
                      return;
                    }
                    setTelegramNotif(next);
                  }}
                />
              </div>
            </SettingRow>
            <SettingRow title="Desktop notifications" description="Show a native notification when scans complete.">
              <Switch checked={desktopNotif} onCheckedChange={setDesktopNotif} />
            </SettingRow>
            <SettingRow title="New assets only" description="Suppress notifications for empty scans.">
              <Switch checked={newOnly} onCheckedChange={setNewOnly} />
            </SettingRow>
          </div>
        </section>

        <section className="soft-shadow rounded-xl border border-border bg-card p-6">
          <h2 className="text-sm font-semibold mb-1">Appearance</h2>
          <p className="text-xs text-muted-foreground mb-4">
            InstaScanner is designed for extended late-night review sessions.
          </p>
          <div className="divide-y divide-border">
            <SettingRow title="Dark Mode" description="Dark mode is enforced by design.">
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground">Locked on</Label>
                <Switch checked disabled />
              </div>
            </SettingRow>
          </div>
        </section>
      </div>
    </div>
  );
}
