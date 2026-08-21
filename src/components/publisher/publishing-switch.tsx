import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudCog, LoaderCircle, PauseCircle, PlayCircle, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/activity-log";
import { useState } from "react";

export const publishingStateKey = ["publisher-publishing-state"] as const;

/**
 * Reads the *own* profile only. RLS additionally restricts both the read and
 * the write to `auth.uid() = id`, so an operator can never see or change
 * another operator's kill-switch.
 */
export async function loadPublishingPaused(): Promise<boolean | null> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("publishing_paused")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (error) throw error;
  return data?.publishing_paused ?? null;
}

export function usePublishingPaused() {
  return useQuery({
    queryKey: publishingStateKey,
    queryFn: loadPublishingPaused,
    retry: false,
  });
}

export function PublishingSwitchCard() {
  const qc = useQueryClient();
  const [confirmResume, setConfirmResume] = useState(false);
  const { data: paused, isLoading, error } = usePublishingPaused();

  const mutation = useMutation({
    mutationFn: async (nextPaused: boolean) => {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) throw new Error("Not signed in");
      // Scoped to the authenticated operator; RLS enforces the same ownership.
      const { data, error: updateError } = await supabase
        .from("profiles")
        .update({ publishing_paused: nextPaused })
        .eq("id", userData.user.id)
        .select("publishing_paused")
        .maybeSingle();
      if (updateError) throw updateError;
      if (!data) throw new Error("Profile could not be updated");
      return data.publishing_paused;
    },
    onSuccess: (nextPaused) => {
      setConfirmResume(false);
      qc.setQueryData(publishingStateKey, nextPaused);
      qc.invalidateQueries({ queryKey: publishingStateKey });
      toast.success(nextPaused ? "Publishing paused" : "Cloud publishing active");
      void logActivity(
        nextPaused ? "publishing_paused" : "publishing_resumed",
        nextPaused
          ? "Operator paused cloud publishing"
          : "Operator resumed cloud publishing",
      );
    },
    onError: (mutationError) =>
      toast.error(
        mutationError instanceof Error
          ? mutationError.message
          : "Publishing state could not be changed",
      ),
  });

  if (isLoading) return null;

  if (error || paused === null) {
    return (
      <Card className="border-amber-500/30 bg-amber-500/[0.05]">
        <CardContent className="flex items-center gap-3 py-4 text-sm">
          <ShieldAlert className="h-4 w-4 text-amber-300" />
          Publishing status is unavailable. Nothing is published while the status is unknown.
        </CardContent>
      </Card>
    );
  }

  const busy = mutation.isPending;

  return (
    <Card
      id="publishing-switch"
      className={
        paused ? "border-amber-500/30 bg-amber-500/[0.05]" : "border-emerald-500/25 bg-emerald-500/[0.04]"
      }
    >
      <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
        <div className="flex min-w-0 items-start gap-3">
          {paused ? (
            <PauseCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
          ) : (
            <CloudCog className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
          )}
          <div>
            <p className="text-sm font-medium">
              {paused ? "Publishing paused" : "Cloud publishing active"}
            </p>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
              {paused
                ? "Scheduling is blocked and the cloud worker never claims your posts while publishing is paused."
                : "Scheduled posts can be published by the cloud worker even when this browser and your laptop are offline."}
            </p>
            {confirmResume ? (
              <p className="mt-2 max-w-2xl text-xs leading-5 text-amber-200">
                Resume cloud publishing? From that moment the cloud worker may publish every
                scheduled post to Instagram on its own — without your browser or laptop being
                online. Already approved posts are only published after you schedule them.
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className={
              paused ? "border-amber-500/30 text-amber-300" : "border-emerald-500/30 text-emerald-300"
            }
          >
            {paused ? "PAUSED" : "ACTIVE"}
          </Badge>
          {paused ? (
            confirmResume ? (
              <>
                <Button size="sm" disabled={busy} onClick={() => mutation.mutate(false)}>
                  {busy ? (
                    <LoaderCircle className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <PlayCircle className="mr-2 h-3.5 w-3.5" />
                  )}
                  Confirm resume
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setConfirmResume(false)}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button size="sm" disabled={busy} onClick={() => setConfirmResume(true)}>
                <PlayCircle className="mr-2 h-3.5 w-3.5" /> Resume publishing
              </Button>
            )
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => mutation.mutate(true)}
            >
              {busy ? (
                <LoaderCircle className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <PauseCircle className="mr-2 h-3.5 w-3.5" />
              )}
              Pause publishing
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
