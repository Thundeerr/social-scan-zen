import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  Clapperboard,
  FileCheck2,
  LockKeyhole,
  MessageSquareText,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useState } from "react";

type ContentPost = Database["public"]["Tables"]["content_posts"]["Row"];

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
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
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
  });

  const seedMutation = useMutation({
    mutationFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("No active operator session");
      const { error: insertError } = await supabase.from("content_posts").insert({
        user_id: auth.user.id,
        post_key: "T003-live-001",
        title: "Live Follower Tracker",
        hook: "Watch it grow.",
        caption:
          "Watching a follower count once tells you almost nothing. Watching it move live shows you exactly when momentum starts.",
        first_comment: "Try the Live Follower Tracker on FollowerStar.",
        status: "review",
      });
      if (insertError) throw insertError;
    },
    onSuccess: () => {
      toast.success("T003 is ready for review");
      qc.invalidateQueries({ queryKey: ["content-posts"] });
    },
    onError: () => toast.error("Apply the prepared database migration first."),
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
            Review the batch twice a month. InstaScanner prepares Reel, Feed, Story and first
            comment for the schedule.
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

      {error && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
            <div>
              <p className="text-sm font-medium">Publisher database upgrade is prepared</p>
              <p className="mt-1 text-xs text-muted-foreground">
                The new tables are still local and have not changed the live InstaScanner database.
              </p>
            </div>
            <Badge variant="outline" className="border-amber-500/30 text-amber-300">
              Safe preview
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
                LOCAL PACKAGE READY
              </Badge>
              <h2 className="text-2xl font-semibold tracking-tight">Live Follower Tracker</h2>
              <p className="mt-2 text-sm font-medium text-primary">Watch it grow.</p>
              <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">
                T003-live-001 already contains the viral cover, Reel, Story plan, caption and first
                comment. Connect it to the shared queue after the database upgrade is approved.
              </p>
              <Button
                className="mt-6 w-fit"
                onClick={() => seedMutation.mutate()}
                disabled={seedMutation.isPending || !!error}
              >
                <Clapperboard className="mr-2 h-4 w-4" /> Add first package
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {posts.map((post) => (
            <Card key={post.id} className="overflow-hidden border-border/70 bg-card/70">
              <div className="grid md:grid-cols-[220px_1fr]">
                <div className="aspect-[3/4] bg-muted/30">
                  <img
                    src="/media/T003-cover-grid.jpg"
                    alt="Content cover"
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="p-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <Badge variant="outline">{post.status.toUpperCase()}</Badge>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {post.post_key}
                    </span>
                  </div>
                  <h2 className="mt-5 text-xl font-semibold tracking-tight">{post.title}</h2>
                  <p className="mt-1 text-sm font-medium text-primary">{post.hook}</p>
                  <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
                    {post.caption}
                  </p>

                  <div className="mt-5 grid grid-cols-2 gap-2 lg:grid-cols-4">
                    <Channel label="Reel" ready={!!post.reel_storage_path} />
                    <Channel label="Feed" ready={!!post.cover_storage_path} />
                    <Channel label="Story" ready={!!post.story_storage_path} />
                    <Channel label="Comment" ready={!!post.first_comment} />
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
                      disabled={post.status === "approved" || decisionMutation.isPending}
                    >
                      <CheckCircle2 className="mr-2 h-4 w-4" />{" "}
                      {post.status === "approved" ? "Approved" : "Approve for schedule"}
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          ))}
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

function Channel({ label, ready }: { label: string; ready: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border/60 bg-background/40 px-3 py-2 text-xs">
      <span>{label}</span>
      {ready ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
      ) : (
        <CircleDashed className="h-3.5 w-3.5 text-muted-foreground" />
      )}
    </div>
  );
}
