import { useState } from "react";
import {
  Captions,
  BookMarked,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Grid3X3,
  Instagram,
  Link2,
  Play,
  ShieldCheck,
  Volume2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Database } from "@/integrations/supabase/types";
import { PublisherDryRunPanel } from "./publisher-dry-run";

type ContentPost = Database["public"]["Tables"]["content_posts"]["Row"];
type ContentPublication = Database["public"]["Tables"]["content_publications"]["Row"];

export type ReviewablePost = ContentPost & {
  coverUrl: string | null;
  publications: ContentPublication[];
  reelUrl: string | null;
  storyUrl: string | null;
};

export function ContentReviewDialog({ post }: { post: ReviewablePost }) {
  const [open, setOpen] = useState(false);
  const ready = Boolean(
    post.coverUrl &&
    post.reelUrl &&
    post.storyUrl &&
    post.caption &&
    (post.story_publish_mode === "automatic_no_link" || post.story_link_url),
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Play className="mr-2 h-4 w-4" /> Review package
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[94vh] max-w-5xl overflow-y-auto p-0">
        <DialogHeader className="border-b border-border/60 px-5 py-4 md:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3 pr-8">
            <div>
              <div className="font-mono text-[10px] text-primary">{post.post_key}</div>
              <DialogTitle className="mt-1 text-lg">{post.title}</DialogTitle>
            </div>
            <Badge
              variant="outline"
              className={
                ready
                  ? "border-emerald-500/30 text-emerald-300"
                  : "border-amber-500/30 text-amber-300"
              }
            >
              {ready ? <CheckCircle2 className="mr-1 h-3 w-3" /> : null}
              {ready ? "Package complete" : "Package incomplete"}
            </Badge>
          </div>
        </DialogHeader>

        <div className="grid lg:grid-cols-[minmax(320px,440px)_1fr]">
          <div className="border-b border-border/60 bg-black/20 p-4 lg:border-b-0 lg:border-r md:p-6">
            <Tabs defaultValue="reel">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="reel">Reel</TabsTrigger>
                <TabsTrigger value="story">Story</TabsTrigger>
                <TabsTrigger value="grid">Profile crop</TabsTrigger>
              </TabsList>
              <TabsContent value="reel" className="mt-4">
                <VerticalVideo url={post.reelUrl} label="Reel preview" safeZone />
              </TabsContent>
              <TabsContent value="story" className="mt-4">
                <VerticalVideo
                  url={post.storyUrl}
                  label="Story preview"
                  safeZone
                  linkStickerLabel={
                    post.story_publish_mode === "manual_link_sticker"
                      ? post.story_link_label
                      : undefined
                  }
                />
              </TabsContent>
              <TabsContent value="grid" className="mt-4">
                <ProfileCropPreview url={post.coverUrl} />
              </TabsContent>
            </Tabs>
          </div>

          <div className="space-y-6 p-5 md:p-6">
            <section>
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                <Captions className="h-3 w-3" /> Hook
              </div>
              <p className="mt-2 text-xl font-semibold tracking-tight">{post.hook}</p>
            </section>

            <CopySection label="Caption" value={post.caption} />
            <CopySection
              label="First comment"
              value={post.first_comment || "Not included"}
              muted={!post.first_comment}
            />
            <CopySection
              label="Alt text"
              value={post.alt_text || "Not included"}
              muted={!post.alt_text}
            />

            <PublisherDryRunPanel post={post} />

            {post.story_publish_mode === "manual_link_sticker" ? (
              <section className="rounded-lg border border-primary/25 bg-primary/[0.06] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-primary">
                    <Link2 className="h-4 w-4" /> Story link handoff
                  </div>
                  <Badge variant="outline" className="border-amber-500/30 text-amber-300">
                    Mobile confirmation
                  </Badge>
                </div>
                <div className="mt-3 text-sm font-medium">{post.story_link_label}</div>
                <a
                  href={post.story_link_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 flex items-start gap-1 break-all text-xs leading-5 text-primary underline-offset-4 hover:underline"
                >
                  {post.story_link_url}
                  <ExternalLink className="mt-0.5 h-3 w-3 shrink-0" />
                </a>
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  The Story stays in handoff mode until the link sticker is added and confirmed in
                  the Instagram app. Tracking parameters are added automatically.
                </p>
                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(post.story_link_url);
                        toast.success("Story link copied");
                      } catch {
                        toast.error("Could not copy the Story link");
                      }
                    }}
                  >
                    <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy link
                  </Button>
                  {post.storyUrl ? (
                    <Button asChild variant="outline" size="sm">
                      <a
                        href={post.storyUrl}
                        download={`${post.post_key}-story.mp4`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Download className="mr-1.5 h-3.5 w-3.5" /> Get Story
                      </a>
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" disabled>
                      <Download className="mr-1.5 h-3.5 w-3.5" /> Get Story
                    </Button>
                  )}
                  <Button asChild size="sm">
                    <a href="instagram://story-camera">
                      <Instagram className="mr-1.5 h-3.5 w-3.5" /> Instagram
                    </a>
                  </Button>
                </div>
                <ol className="mt-3 list-inside list-decimal space-y-1 text-[10px] leading-4 text-muted-foreground">
                  <li>Copy the tracked link.</li>
                  <li>Save or share the prepared Story video.</li>
                  <li>Open Instagram, add the link sticker and publish.</li>
                </ol>
              </section>
            ) : (
              <section className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-emerald-300">
                    <Instagram className="h-4 w-4" /> Automatic Story
                  </div>
                  <Badge variant="outline" className="border-emerald-500/30 text-emerald-300">
                    Cloud delivery
                  </Badge>
                </div>
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  InstaScanner publishes this Story after the Reel and first comment. Instagram's
                  publishing API cannot add a link sticker, so this mode intentionally posts without
                  one.
                </p>
              </section>
            )}

            {post.highlight_enabled && (
              <section className="rounded-lg border border-violet-500/25 bg-violet-500/[0.06] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-violet-300">
                    <BookMarked className="h-4 w-4" /> Highlight destination
                  </div>
                  <Badge variant="outline" className="border-violet-500/30 text-violet-300">
                    One app tap remains
                  </Badge>
                </div>
                <div className="mt-3 text-sm font-semibold">{post.highlight_name}</div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  After the Story is live, InstaScanner keeps this destination visible until you add
                  it to the matching Instagram Highlight and confirm the handoff.
                </p>
              </section>
            )}

            <div className="rounded-lg border border-primary/20 bg-primary/[0.05] p-4">
              <div className="flex items-center gap-2 text-xs font-medium text-primary">
                <ShieldCheck className="h-4 w-4" /> Safe review mode
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                Reviewing cannot publish anything. Approval and scheduling are separate actions;
                only the cloud worker can contact Instagram when the scheduled time arrives.
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function VerticalVideo({
  url,
  label,
  safeZone,
  linkStickerLabel,
}: {
  url: string | null;
  label: string;
  safeZone?: boolean;
  linkStickerLabel?: string;
}) {
  return (
    <div className="relative mx-auto aspect-[9/16] w-full max-w-[360px] overflow-hidden rounded-[24px] border border-white/15 bg-black shadow-2xl">
      {url ? (
        <video
          src={url}
          aria-label={label}
          controls
          playsInline
          preload="metadata"
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="grid h-full place-items-center text-center text-xs text-white/50">
          No video uploaded
        </div>
      )}
      {safeZone && (
        <div className="pointer-events-none absolute inset-x-[7%] bottom-[17%] top-[8%] rounded-xl border border-dashed border-white/45">
          <span className="absolute left-2 top-2 rounded-full bg-black/50 px-2 py-1 text-[8px] uppercase tracking-[0.14em] text-white/70 backdrop-blur">
            Text safe zone
          </span>
        </div>
      )}
      {linkStickerLabel && (
        <div className="pointer-events-none absolute inset-x-[18%] bottom-[23%] flex items-center justify-center rounded-xl border border-white/25 bg-white/90 px-3 py-2 text-center text-[11px] font-semibold text-black shadow-lg">
          <Link2 className="mr-1.5 h-3.5 w-3.5" /> {linkStickerLabel}
        </div>
      )}
      <div className="pointer-events-none absolute bottom-3 right-3 flex items-center gap-1 rounded-full bg-black/45 px-2 py-1 text-[9px] text-white/70 backdrop-blur">
        <Volume2 className="h-3 w-3" /> Sound check
      </div>
    </div>
  );
}

function ProfileCropPreview({ url }: { url: string | null }) {
  return (
    <div className="mx-auto w-full max-w-[360px]">
      <div className="relative aspect-[9/16] overflow-hidden rounded-[24px] border border-white/15 bg-black shadow-2xl">
        {url ? (
          <img src={url} alt="Profile crop preview" className="h-full w-full object-cover" />
        ) : null}
        <div className="pointer-events-none absolute inset-0 bg-black/25" />
        <div className="pointer-events-none absolute inset-x-0 top-1/2 aspect-[3/4] -translate-y-1/2 border-2 border-primary shadow-[0_0_0_999px_rgba(0,0,0,0.38)]">
          <div className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-primary px-2 py-1 text-[8px] font-semibold uppercase tracking-[0.14em] text-primary-foreground">
            <Grid3X3 className="h-3 w-3" /> Profile grid
          </div>
          <div className="absolute inset-x-[8%] bottom-[10%] top-[10%] rounded-lg border border-dashed border-white/55" />
        </div>
      </div>
      <p className="mt-3 text-center text-[10px] leading-4 text-muted-foreground">
        The bright frame shows the vertical profile-grid crop. Keep logo and hook inside the dashed
        inner area.
      </p>
    </div>
  );
}

function CopySection({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <section>
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <p
        className={`mt-2 whitespace-pre-wrap text-sm leading-6 ${muted ? "italic text-muted-foreground" : "text-foreground/90"}`}
      >
        {value}
      </p>
    </section>
  );
}

