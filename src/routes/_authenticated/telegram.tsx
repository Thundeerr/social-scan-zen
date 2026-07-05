import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Send, Loader2, Radar } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import {
  detectTelegramChatIdFn,
  getTelegramPrefsFn,
  saveTelegramPrefsFn,
  sendTelegramTestFn,
} from "@/lib/telegram.functions";

export const Route = createFileRoute("/_authenticated/telegram")({
  head: () => ({ meta: [{ title: "Telegram — InstaScanner" }] }),
  component: TelegramPage,
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

function TelegramPage() {
  const [telegramNotif, setTelegramNotif] = useState(false);
  const [telegramChatId, setTelegramChatId] = useState("");

  const qc = useQueryClient();
  const getPrefs = useServerFn(getTelegramPrefsFn);
  const savePrefs = useServerFn(saveTelegramPrefsFn);
  const sendTest = useServerFn(sendTelegramTestFn);
  const detectId = useServerFn(detectTelegramChatIdFn);

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
    mutationFn: () => sendTest(),
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
    if (prefsQuery.data?.chatId === telegramChatId) return;
    commitPrefs(telegramChatId, telegramNotif && !!telegramChatId.trim());
  };

  return (
    <div className="p-6 md:p-8 space-y-6">
      <PageHeader
        eyebrow="Signal relay"
        eyebrowTone="muted"
        eyebrowDot={false}
        title="Telegram"
        description="Route priority signals and approval digests to a Telegram chat."
      />

      <div className="max-w-3xl space-y-6">
        <section className="soft-shadow rounded-xl border border-border bg-card p-6">
          <h2 className="text-sm font-semibold mb-1">Telegram bot</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Message the bot with /start, tap Detect to pull your chat ID, then flip the switch to enable delivery.
          </p>
          <div className="divide-y divide-border">
            <SettingRow
              title="Chat delivery"
              description="Route alerts and approved-session digests to this Telegram chat."
            >
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[320px]">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Send className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={telegramChatId}
                      onChange={(e) => setTelegramChatId(e.target.value)}
                      onBlur={handleTelegramBlur}
                      placeholder="Chat ID (e.g. 123456789)"
                      inputMode="numeric"
                      className="h-9 pl-7 text-xs font-mono"
                    />
                  </div>
                  <Switch
                    checked={telegramNotif}
                    onCheckedChange={handleTelegramToggle}
                    disabled={saveMutation.isPending || prefsQuery.isLoading}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 flex-1 gap-1.5 text-[11px]"
                    onClick={() => detectMutation.mutate()}
                    disabled={detectMutation.isPending}
                  >
                    {detectMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Radar className="h-3.5 w-3.5" />
                    )}
                    Detect chat
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 flex-1 gap-1.5 text-[11px]"
                    onClick={() => testMutation.mutate(telegramChatId)}
                    disabled={testMutation.isPending || !telegramChatId.trim()}
                  >
                    {testMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                    Send test
                  </Button>
                </div>
              </div>
            </SettingRow>
          </div>
        </section>
      </div>
    </div>
  );
}
