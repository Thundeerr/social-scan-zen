import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  AlertTriangle,
  FileCheck2,
  Hand,
  LockKeyhole,
  MessageSquareText,
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
const SIGNED_URL_SECONDS = 60 * 60;
const SIGNED_URL_REFRESH_MS = 45 * 60 * 1000;

function chunks<T>(items: T[], size = 50) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
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
      if (item.signedUrl) signedByPath.set(item.path, item.signedUrl);
    }
  }

  return data.map(
    (post): ReviewablePost => ({
      ...post,
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

function ContentPublisherPage() {
  const qc = useQueryClient();
  const [reviewNote, setReviewNote] = useState("");
  const [noteOpenFor, setNoteOpenFor] = useState<string | null>(null);
  const {
    data: posts = [],
    error,
    isLoading,
  } = useQuery({
    queryKey: ["content-posts"],
    queryFn: loadPosts,
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
      const note = decision === "changes_requested" ? reviewNote.trim() : null;
      if (decision === "changes_requested" && !note)
        throw new Error("Add a short review note first.");

      const { error: reviewError } = await supabase.rpc("review_content_post", {
        _content_post_id: post.id,
        _decision: decision,
        _note: note,
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
            Review the batch twice a month. InstaScanner prepares one Reel for Reels + Feed, the
            first comment and a Story link handoff.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.15em] text-amber-300">
          <LockKeyhole className="h-3.5 w-3.5" /> Publishing locked
        </div>
      </div>

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

                    <div className="mt-5 grid grid-cols-1 gap-2 lg:grid-cols-3">
                      <Channel
                        label={post.share_to_feed ? "Reel + Feed" : "Reel only"}
                        state={dryRun.steps[0].state}
                      />
                      <Channel label="Story link handoff" state={dryRun.steps[2].state} />
                      <Channel label="First comment" state={dryRun.steps[1].state} />
                    </div>

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
                      >
                        {noteOpenFor === post.id ? "Save request" : "Request changes"}
                      </Button>
                      <Button
                        onClick={() => decisionMutation.mutate({ post, decision: "approved" })}
                        disabled={
                          post.status === "approved" || decisionMutation.isPending || !dryRun.ready
                        }
                      >
                        <CheckCircle2 className="mr-2 h-4 w-4" />{" "}
                        {post.status === "approved" ? "Approved" : "Approve for schedule"}
                      </Button>
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

function Channel({
  label,
  state,
}: {
  label: string;
  state: "ready" | "blocked" | "skipped" | "manual";
}) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border/60 bg-background/40 px-3 py-2 text-xs">
      <span>{label}</span>
      {state === "ready" ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
      ) : state === "manual" ? (
        <Hand className="h-3.5 w-3.5 text-primary" />
      ) : state === "skipped" ? (
        <SkipForward className="h-3.5 w-3.5 text-muted-foreground" />
      ) : state === "blocked" ? (
        <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
      ) : (
        <CircleDashed className="h-3.5 w-3.5 text-muted-foreground" />
      )}
    </div>
  );
}
