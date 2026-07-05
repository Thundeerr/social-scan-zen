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

  const qc = useQueryClient();
  const getPrefs = useServerFn(getTelegramPrefsFn);
  const savePrefs = useServerFn(saveTelegramPrefsFn);
  const sendTest = useServerFn(sendTelegramTestFn);
  const detectId = useServerFn(detectTelegramChatIdFn);

  // Hydrate Telegram preferences from the operator's profile row.
  const prefsQuery = useQuery({
    queryKey: ["telegram-prefs"],
    queryFn: () => getPrefs(),
    staleTime: 30_000,
  });
  useEffect(() => {
    if (!prefsQuery.data) return;
    setTelegramChatId(prefsQuery.data.chatId);
    setTelegramNotif(prefsQuery.data.enabled);
  }, [prefsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (input: { chatId: string; enabled: boolean }) =>
      savePrefs({ data: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["telegram-prefs"] }),
  });

  const testMutation = useMutation({
    mutationFn: (chatId: string) => sendTest({ data: { chatId } }),
    onSuccess: () => toast.success("Test signal delivered to Telegram"),
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Failed to send test"),
  });

  const detectMutation = useMutation({
    mutationFn: () => detectId(),
    onSuccess: (res: { chatId: string | null }) => {
      if (res.chatId) {
        setTelegramChatId(res.chatId);
        toast.success(`Detected chat ID ${res.chatId}`);
      } else {
        toast.error("No recent messages — send /start to the bot first");
      }
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Failed to detect"),
  });

  const commitPrefs = (chatId: string, enabled: boolean) => {
    saveMutation.mutate(
      { chatId, enabled },
      {
        onError: (err: unknown) =>
          toast.error(err instanceof Error ? err.message : "Save failed"),
      },
    );
  };

  const handleTelegramToggle = (next: boolean) => {
    if (next && !telegramChatId.trim()) {
      toast.error("Enter a Telegram chat ID first");
      return;
    }
    setTelegramNotif(next);
    commitPrefs(telegramChatId, next);
  };

  const handleTelegramBlur = () => {
    // Auto-save the chat ID whenever the operator moves focus away.
    if (prefsQuery.data?.chatId === telegramChatId) return;
    commitPrefs(telegramChatId, telegramNotif && !!telegramChatId.trim());
  };

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
              description="Manage Telegram delivery from the dedicated Telegram section."
            >
              <Button asChild variant="outline" size="sm" className="h-9 gap-1.5">
                <a href="/telegram">
                  <Send className="h-3.5 w-3.5" />
                  Open Telegram
                </a>
              </Button>
            </SettingRow>
          </div>
        </section>
      </div>
    </div>
  );
}
