import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  AlertTriangle,
  BookMarked,
  FileCheck2,
  Hand,
  CloudCog,
  LoaderCircle,
  MessageSquareText,
  Instagram,
  Send,
  ShieldCheck,
  SkipForward,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ContentBatchImport } from "@/components/publisher/content-batch-import";
import {
  ContentReviewDialog,
  type ReviewablePost,
} from "@/components/publisher/content-review-dialog";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { buildPublisherDryRun, type PublisherDryRun } from "@/lib/publisher-preflight";
import { useState } from "react";

type ContentPost = Database["public"]["Tables"]["content_posts"]["Row"];
type ContentPublication = Database["public"]["Tables"]["content_publications"]["Row"];
type InstagramConnection = Pick<
  Database["public"]["Tables"]["ig_connections"]["Row"],
  "ig_username" | "token_expires_at" | "status" | "last_error"
>;
const SIGNED_URL_SECONDS = 60 * 60;
const SIGNED_URL_REFRESH_MS = 45 * 60 * 1000;

function chunks<T>(items: T[], size = 50) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function localDateTimeValue(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export const Route = createFileRoute("/_authenticated/publisher")({
  head: () => ({
    meta: [
      { title: "Content Publisher — InstaScanner" },
      {
        name: "description",
        content: "Review, approve and schedule FollowerStar content packages.",
      },
    ],
  }),
  component: ContentPublisherPage,
});

async function loadPosts() {
  const { data, error } = await supabase
    .from("content_posts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;

  const publicationsByPost = new Map<string, ContentPublication[]>();
  const postIds = data.map((post) => post.id);
  for (const idChunk of chunks(postIds)) {
    const { data: publications, error: publicationError } = await supabase
      .from("content_publications")
      .select("*")
      .in("content_post_id", idChunk);
    if (publicationError) throw publicationError;
    for (const publication of publications ?? []) {
      const existing = publicationsByPost.get(publication.content_post_id) ?? [];
      existing.push(publication);
      publicationsByPost.set(publication.content_post_id, existing);
    }
  }

  const paths = [
    ...new Set(
      data.flatMap((post) =>
        [post.cover_storage_path, post.reel_storage_path, post.story_storage_path].filter(
          (path): path is string => Boolean(path),
        ),
      ),
    ),
  ];
  const signedByPath = new Map<string, string>();
  for (const pathChunk of chunks(paths)) {
    const { data: signed, error: signedError } = await supabase.storage
      .from("ig-publish")
      .createSignedUrls(pathChunk, SIGNED_URL_SECONDS);
    if (signedError) throw signedError;
    for (const item of signed ?? []) {
      if (item.path && item.signedUrl) signedByPath.set(item.path, item.signedUrl);
    }
  }

  return data.map(
    (post): ReviewablePost => ({
      ...post,
      publications: publicationsByPost.get(post.id) ?? [],
      coverUrl: post.cover_storage_path
        ? (signedByPath.get(post.cover_storage_path) ?? null)
        : null,
      reelUrl: post.reel_storage_path ? (signedByPath.get(post.reel_storage_path) ?? null) : null,
      storyUrl: post.story_storage_path
        ? (signedByPath.get(post.story_storage_path) ?? null)
        : null,
    }),
  );
}

async function loadInstagramConnection(): Promise<InstagramConnection | null> {
  const { data, error } = await supabase
    .from("ig_connections")
    .select("ig_username,token_expires_at,status,last_error")
    .maybeSingle();
  if (error) throw error;
  return data;
}

function ContentPublisherPage() {
  const qc = useQueryClient();
  const [reviewNote, setReviewNote] = useState("");
  const [noteOpenFor, setNoteOpenFor] = useState<string | null>(null);
  const [scheduleOpenFor, setScheduleOpenFor] = useState<string | null>(null);
  const [scheduleValue, setScheduleValue] = useState("");
  const {
    data: posts = [],
    error,
    isLoading,
  } = useQuery({
    queryKey: ["content-posts"],
    queryFn: loadPosts,
    retry: false,
    refetchInterval: (query) => {
      const currentPosts = query.state.data as ReviewablePost[] | undefined;
      const needsLiveProgress = currentPosts?.some((post) => {
        if (post.status === "publishing") return true;
        if (post.status !== "scheduled" || !post.scheduled_for) return false;
        return new Date(post.scheduled_for).getTime() <= Date.now() + 2 * 60_000;
      });
      return needsLiveProgress ? 15_000 : SIGNED_URL_REFRESH_MS;
    },
  });
  const {
    data: instagramConnection,
    error: instagramConnectionError,
    isLoading: instagramConnectionLoading,
  } = useQuery({
    queryKey: ["publisher-instagram-connection"],
    queryFn: loadInstagramConnection,
    retry: false,
    refetchInterval: SIGNED_URL_REFRESH_MS,
  });

  const decisionMutation = useMutation({
    mutationFn: async ({
      post,
      decision,
    }: {
      post: ContentPost;
      decision: "approved" | "changes_requested";
    }) => {
      const note = decision === "changes_requested" ? reviewNote.trim() : "";
      if (decision === "changes_requested" && !note)
        throw new Error("Add a short review note first.");

      const { error: reviewError } = await supabase.rpc("review_content_post", {
        _content_post_id: post.id,
        _decision: decision,
        _note: note || undefined,
      });
      if (reviewError) throw reviewError;
    },
    onSuccess: (_, variables) => {
      toast.success(
        variables.decision === "approved" ? "Approved for scheduling" : "Change request saved",
      );
      setNoteOpenFor(null);
      setReviewNote("");
      qc.invalidateQueries({ queryKey: ["content-posts"] });
    },
    onError: (mutationError) =>
      toast.error(
        mutationError instanceof Error ? mutationError.message : "Decision could not be saved",
      ),
  });

  const scheduleMutation = useMutation({
    mutationFn: async ({ post, scheduledFor }: { post: ContentPost; scheduledFor: string }) => {
      const { error: scheduleError } = await supabase.rpc("schedule_content_post", {
        _content_post_id: post.id,
        _scheduled_for: scheduledFor,
      });
      if (scheduleError) throw scheduleError;
    },
    onSuccess: (_, variables) => {
      const delay = new Date(variables.scheduledFor).getTime() - Date.now();
      toast.success(delay < 90_000 ? "Queued for cloud publishing" : "Publishing time saved");
      setScheduleOpenFor(null);
      setScheduleValue("");
      qc.invalidateQueries({ queryKey: ["content-posts"] });
    },
    onError: (mutationError) =>
      toast.error(
        mutationError instanceof Error ? mutationError.message : "Schedule could not be saved",
      ),
  });

  const handoffMutation = useMutation({
    mutationFn: async ({
      post,
      channel,
    }: {
      post: ContentPost;
      channel: "story_handoff" | "highlight_handoff";
    }) => {
      const { error: handoffError } = await supabase.rpc("confirm_content_handoff", {
        _content_post_id: post.id,
        _channel: channel,
      });
      if (handoffError) throw handoffError;
    },
    onSuccess: (_, variables) => {
      toast.success(
        variables.channel === "highlight_handoff"
          ? "Highlight assignment confirmed"
          : "Story handoff confirmed",
      );
      qc.invalidateQueries({ queryKey: ["content-posts"] });
    },
    onError: (mutationError) =>
      toast.error(
        mutationError instanceof Error ? mutationError.message : "Handoff could not be confirmed",
      ),
  });

  const counts = {
    review: posts.filter((post) => post.status === "review").length,
    approved: posts.filter((post) => post.status === "approved").length,
    scheduled: posts.filter((post) => post.status === "scheduled").length,
    published: posts.filter((post) => post.status === "published").length,
  };

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            <Sparkles className="h-3 w-3 text-primary" /> FollowerStar Content OS
          </div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">Content Publisher</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Review the batch twice a month. InstaScanner prepares one Reel for the Reels tab, the
            first comment and a Story or link-sticker handoff.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.15em] text-emerald-300">
          <CloudCog className="h-3.5 w-3.5" /> Cloud publisher
        </div>
      </div>

      <InstagramConnectionCard
        connection={instagramConnection ?? null}
        unavailable={Boolean(instagramConnectionError)}
        loading={instagramConnectionLoading}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <QueueMetric label="To review" value={counts.review} icon={FileCheck2} tone="primary" />
        <QueueMetric label="Approved" value={counts.approved} icon={ShieldCheck} tone="success" />
        <QueueMetric label="Scheduled" value={counts.scheduled} icon={CalendarClock} />
        <QueueMetric label="Published" value={counts.published} icon={Send} />
      </div>

      <ContentBatchImport
        onImported={() => qc.invalidateQueries({ queryKey: ["content-posts"] })}
      />

      {error && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
            <div>
              <p className="text-sm font-medium">Publisher could not load the review queue</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Your content is unchanged. Check the connection and reload the page.
              </p>
            </div>
            <Badge variant="outline" className="border-amber-500/30 text-amber-300">
              Nothing published
            </Badge>
          </CardContent>
        </Card>
      )}

      {!isLoading && posts.length === 0 ? (
        <Card className="overflow-hidden border-border/70 bg-card/70">
          <div className="grid md:grid-cols-[240px_1fr]">
            <div className="aspect-[3/4] bg-muted/30">
              <img
                src="/media/T003-cover-grid.jpg"
                alt="Live Follower Tracker cover"
                className="h-full w-full object-cover"
              />
            </div>
            <div className="flex flex-col justify-center p-6 md:p-8">
              <Badge variant="outline" className="mb-4 w-fit border-primary/30 text-primary">
                READY FOR YOUR FIRST BATCH
              </Badge>
              <h2 className="text-2xl font-semibold tracking-tight">No packages to review yet</h2>
              <p className="mt-2 text-sm font-medium text-primary">
                Import once. Review everything.
              </p>
              <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">
                Use the private batch importer above. InstaScanner checks every manifest, cover,
                Reel and Story before anything reaches this review queue.
              </p>
            </div>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {posts.map((post) => {
            const dryRun = buildPublisherDryRun(post);
            const canReview = ["review", "changes_requested"].includes(post.status);
            const publicationByChannel = new Map(
              post.publications.map((publication) => [publication.channel, publication]),
            );
            const storyChannel =
              post.story_publish_mode === "automatic_no_link" ? "story" : "story_handoff";
            const storyPublication = publicationByChannel.get(storyChannel);
            const highlightPublication = publicationByChannel.get("highlight_handoff");
            const actualState = (channel: string, fallback: ChannelState): ChannelState => {
              const publication = publicationByChannel.get(channel);
              if (!publication) return fallback;
              if (publication.status === "published") return "published";
              if (publication.status === "publishing") return "publishing";
              if (publication.status === "failed") return "failed";
              if (publication.status === "skipped") return "skipped";
              return fallback;
            };
            return (
              <Card key={post.id} className="overflow-hidden border-border/70 bg-card/70">
                <div className="grid md:grid-cols-[220px_1fr]">
                  <div className="aspect-[3/4] bg-muted/30">
                    <img
                      src={post.coverUrl ?? "/media/T003-cover-grid.jpg"}
                      alt="Content cover"
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="p-6">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <StatusBadge result={dryRun} />
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {post.post_key}
                      </span>
                    </div>
                    <h2 className="mt-5 text-xl font-semibold tracking-tight">{post.title}</h2>
                    <p className="mt-1 text-sm font-medium text-primary">{post.hook}</p>
                    <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
                      {post.caption}
                    </p>

                    {post.status === "failed" && post.last_publish_error && (
                      <div className="mt-4 rounded-lg border border-red-500/25 bg-red-500/[0.06] p-3 text-xs leading-5 text-red-200">
                        Nothing was duplicated. The last cloud attempt stopped safely:{" "}
                        {post.last_publish_error}
                      </div>
                    )}

                    <div className="mt-5 grid grid-cols-1 gap-2 lg:grid-cols-4">
                      <Channel
                        label={post.share_to_feed ? "Reel + Feed" : "Reel only"}
                        state={actualState("reel", dryRun.steps[0].state)}
                      />
                      <Channel
                        label={
                          post.story_publish_mode === "automatic_no_link"
                            ? "Automatic Story"
                            : "Story link handoff"
                        }
                        state={actualState(storyChannel, dryRun.steps[2].state)}
                      />
                      <Channel
                        label="First comment"
                        state={actualState("first_comment", dryRun.steps[1].state)}
                      />
                      <Channel
                        label={
                          post.highlight_enabled
                            ? `Highlight · ${post.highlight_name}`
                            : "Highlight"
                        }
                        state={actualState("highlight_handoff", dryRun.steps[3].state)}
                      />
                    </div>

                    {storyPublication?.status === "pending" &&
                      storyChannel === "story_handoff" &&
                      publicationByChannel.get("reel")?.status === "published" && (
                        <HandoffCard
                          icon={Instagram}
                          title="Publish the prepared Story in Instagram"
                          detail="Add the link sticker, publish the Story, then confirm it here."
                          actionLabel="Story is live"
                          onConfirm={() =>
                            handoffMutation.mutate({ post, channel: "story_handoff" })
                          }
                          isPending={handoffMutation.isPending}
                        />
                      )}

                    {highlightPublication?.status === "pending" &&
                      storyPublication?.status === "published" && (
                        <HandoffCard
                          icon={BookMarked}
                          title={`Add Story to “${post.highlight_name}”`}
                          detail="Open the live Story in Instagram, choose Highlight and select this destination."
                          actionLabel="Highlight added"
                          onConfirm={() =>
                            handoffMutation.mutate({ post, channel: "highlight_handoff" })
                          }
                          isPending={handoffMutation.isPending}
                        />
                      )}

                    {scheduleOpenFor === post.id && (
                      <div className="mt-5 rounded-lg border border-primary/25 bg-primary/[0.05] p-4">
                        <div className="text-xs font-medium">Choose publishing time</div>
                        <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                          Your browser and laptop can be offline when this time arrives.
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Input
                            type="datetime-local"
                            value={scheduleValue}
                            min={localDateTimeValue(new Date(Date.now() + 60_000))}
                            onChange={(event) => setScheduleValue(event.target.value)}
                            className="min-w-[220px] flex-1"
                          />
                          <Button
                            variant="outline"
                            onClick={() =>
                              scheduleMutation.mutate({
                                post,
                                scheduledFor: new Date().toISOString(),
                              })
                            }
                            disabled={scheduleMutation.isPending}
                          >
                            Publish now
                          </Button>
                          <Button
                            onClick={() => {
                              const scheduledFor = new Date(scheduleValue);
                              if (!scheduleValue || Number.isNaN(scheduledFor.getTime())) {
                                toast.error("Choose a valid publishing time");
                                return;
                              }
                              scheduleMutation.mutate({
                                post,
                                scheduledFor: scheduledFor.toISOString(),
                              });
                            }}
                            disabled={!scheduleValue || scheduleMutation.isPending}
                          >
                            {scheduleMutation.isPending ? (
                              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <CalendarClock className="mr-2 h-4 w-4" />
                            )}
                            Schedule
                          </Button>
                        </div>
                      </div>
                    )}

                    {noteOpenFor === post.id && (
                      <div className="mt-5 space-y-2">
                        <div className="flex items-center gap-2 text-xs font-medium">
                          <MessageSquareText className="h-3.5 w-3.5" /> Change request
                        </div>
                        <Textarea
                          value={reviewNote}
                          onChange={(event) => setReviewNote(event.target.value)}
                          placeholder="What should be improved?"
                        />
                      </div>
                    )}

                    <div className="mt-5 flex flex-wrap justify-end gap-2">
                      <ContentReviewDialog post={post} />
                      <Button
                        variant="outline"
                        onClick={() => {
                          if (noteOpenFor === post.id)
                            decisionMutation.mutate({ post, decision: "changes_requested" });
                          else setNoteOpenFor(post.id);
                        }}
                        disabled={!canReview || decisionMutation.isPending}
                      >
                        {noteOpenFor === post.id ? "Save request" : "Request changes"}
                      </Button>
                      <Button
                        onClick={() => decisionMutation.mutate({ post, decision: "approved" })}
                        disabled={!canReview || decisionMutation.isPending || !dryRun.ready}
                      >
                        <CheckCircle2 className="mr-2 h-4 w-4" />{" "}
                        {canReview ? "Approve for schedule" : "Approved"}
                      </Button>
                      {["approved", "scheduled", "failed"].includes(post.status) && (
                        <Button
                          variant={scheduleOpenFor === post.id ? "secondary" : "default"}
                          onClick={() => {
                            setScheduleOpenFor(scheduleOpenFor === post.id ? null : post.id);
                            setScheduleValue("");
                          }}
                          disabled={scheduleMutation.isPending}
                        >
                          <CalendarClock className="mr-2 h-4 w-4" />
                          {post.status === "failed"
                            ? "Retry safely"
                            : post.status === "scheduled"
                              ? "Reschedule"
                              : "Schedule"}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function InstagramConnectionCard({
  connection,
  unavailable,
  loading,
}: {
  connection: InstagramConnection | null;
  unavailable: boolean;
  loading: boolean;
}) {
  const qc = useQueryClient();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const connectMutation = useMutation({
    mutationFn: async () => startInstagramOAuthFn(),
    onSuccess: ({ authorizeUrl }) => {
      window.location.assign(authorizeUrl);
    },
    onError: (mutationError) =>
      toast.error(
        mutationError instanceof Error ? mutationError.message : "Could not start authorization",
      ),
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => disconnectInstagramFn(),
    onSuccess: () => {
      setConfirmDisconnect(false);
      toast.success("Instagram disconnected. Publishing stays paused.");
      qc.invalidateQueries({ queryKey: ["publisher-instagram-connection"] });
    },
    onError: (mutationError) =>
      toast.error(mutationError instanceof Error ? mutationError.message : "Disconnect failed"),
  });

  if (loading) return null;

  const health = connectionHealth({
    status: connection?.status,
    tokenExpiresAt: connection?.token_expires_at,
  });
  const isActive = health.healthy;
  const needsAttention = health.needsAttention;
  const expiresAt = connection ? new Date(connection.token_expires_at) : null;
  const expiryLabel = expiresAt
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(expiresAt)
    : null;
  const busy = connectMutation.isPending || disconnectMutation.isPending;

  return (
    <Card
      className={
        needsAttention
          ? "border-amber-500/30 bg-amber-500/[0.05]"
          : "border-emerald-500/25 bg-emerald-500/[0.04]"
      }
    >
      <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
        <div className="flex min-w-0 items-start gap-3">
          {needsAttention ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
          ) : (
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
          )}
          <div>
            <p className="text-sm font-medium">
              {unavailable
                ? "Instagram connection status is unavailable"
                : connection
                  ? `@${connection.ig_username} · ${isActive ? "connected" : "action required"}`
                  : "Instagram is not connected"}
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {connection && expiryLabel
                ? `Business Login credential valid until ${expiryLabel}. Scheduling is blocked if it would expire before publishing.`
                : "Connect Instagram before scheduling. Connecting only authorizes the account — it never publishes anything, and publishing stays paused."}
            </p>
            {connection?.last_error ? (
              <p className="mt-1 text-xs text-amber-200">
                Last connection error: {connection.last_error}
              </p>
            ) : null}
            {confirmDisconnect ? (
              <p className="mt-2 text-xs text-amber-200">
                Disconnect @{connection?.ig_username}? Content history and media stay untouched;
                publishing is paused first. Confirm to continue.
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className={
              needsAttention
                ? "border-amber-500/30 text-amber-300"
                : "border-emerald-500/30 text-emerald-300"
            }
          >
            {needsAttention ? "CHECK BEFORE BATCH" : "READY FOR SCHEDULES"}
          </Badge>
          <Button size="sm" disabled={busy} onClick={() => connectMutation.mutate()}>
            {connectMutation.isPending ? (
              <LoaderCircle className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Instagram className="mr-2 h-3.5 w-3.5" />
            )}
            {connection ? "Reconnect Instagram" : "Connect Instagram"}
          </Button>
          {connection ? (
            confirmDisconnect ? (
              <>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => disconnectMutation.mutate()}
                >
                  Confirm disconnect
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setConfirmDisconnect(false)}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => setConfirmDisconnect(true)}
              >
                Disconnect
              </Button>
            )
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function QueueMetric({
  label,
  value,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: number;
  icon: typeof CircleDashed;
  tone?: "default" | "primary" | "success";
}) {
  return (
    <Card className="border-border/70 bg-card/70">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
        <Icon
          className={`h-4 w-4 ${tone === "primary" ? "text-primary" : tone === "success" ? "text-emerald-400" : "text-muted-foreground"}`}
        />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ result }: { result: PublisherDryRun }) {
  const tone = {
    success: "border-emerald-500/30 text-emerald-300",
    warning: "border-amber-500/30 text-amber-300",
    danger: "border-red-500/30 text-red-300",
    neutral: "border-primary/30 text-primary",
  }[result.statusTone];
  return (
    <Badge variant="outline" className={tone}>
      {result.statusLabel}
      {result.blockers.length > 0 ? ` · ${result.blockers.length}` : ""}
    </Badge>
  );
}

type ChannelState =
  | "ready"
  | "blocked"
  | "skipped"
  | "manual"
  | "published"
  | "publishing"
  | "failed";

function Channel({ label, state }: { label: string; state: ChannelState }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border/60 bg-background/40 px-3 py-2 text-xs">
      <span>{label}</span>
      {state === "ready" || state === "published" ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
      ) : state === "publishing" ? (
        <LoaderCircle className="h-3.5 w-3.5 animate-spin text-amber-300" />
      ) : state === "manual" ? (
        <Hand className="h-3.5 w-3.5 text-primary" />
      ) : state === "skipped" ? (
        <SkipForward className="h-3.5 w-3.5 text-muted-foreground" />
      ) : state === "blocked" || state === "failed" ? (
        <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
      ) : (
        <CircleDashed className="h-3.5 w-3.5 text-muted-foreground" />
      )}
    </div>
  );
}

function HandoffCard({
  icon: Icon,
  title,
  detail,
  actionLabel,
  onConfirm,
  isPending,
}: {
  icon: typeof Instagram;
  title: string;
  detail: string;
  actionLabel: string;
  onConfirm: () => void;
  isPending: boolean;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-violet-500/25 bg-violet-500/[0.06] p-4">
      <div className="flex min-w-0 items-start gap-3">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" />
        <div>
          <div className="text-xs font-medium text-violet-200">{title}</div>
          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">{detail}</p>
        </div>
      </div>
      <div className="flex gap-2">
        <Button asChild variant="outline" size="sm">
          <a href="https://www.instagram.com/" target="_blank" rel="noreferrer">
            Open Instagram
          </a>
        </Button>
        <Button size="sm" onClick={onConfirm} disabled={isPending}>
          {isPending ? <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
          {actionLabel}
        </Button>
      </div>
    </div>
  );
}
