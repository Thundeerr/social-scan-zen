import { Check, X, Download, ExternalLink, Heart, RotateCcw } from "lucide-react";
import type { Post } from "@/lib/mock-data";
import { Button } from "@/components/ui/button";
import { postActions } from "@/lib/posts-store";
import { cn } from "@/lib/utils";

const statusStyles: Record<Post["status"], string> = {
  new: "text-primary bg-primary/10 border-primary/20",
  approved: "text-success bg-success/10 border-success/30",
  ignored: "text-muted-foreground bg-muted/40 border-border",
  downloaded: "text-foreground bg-foreground/10 border-foreground/20",
};

export function PostCard({ post }: { post: Post }) {
  const isActioned = post.status !== "new";

  return (
    <article className="soft-shadow group rounded-xl border border-border bg-card overflow-hidden hover:border-primary/30 transition-colors">
      <div className="flex items-center gap-3 px-4 py-3">
        <img src={post.avatar} alt="" className="h-8 w-8 rounded-full ring-1 ring-border" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">@{post.username}</div>
          <div className="text-[11px] text-muted-foreground">detected {post.detectedAt}</div>
        </div>
        <span
          className={cn(
            "text-[10px] uppercase tracking-wider border rounded-full px-2 py-0.5 capitalize",
            statusStyles[post.status],
          )}
        >
          {post.status}
        </span>
      </div>

      <div className="relative aspect-square overflow-hidden bg-muted">
        <img
          src={post.thumbnail}
          alt=""
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
          loading="lazy"
        />
        <div className="absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-black/60 backdrop-blur px-2 py-0.5 text-[10px] text-white">
          <Heart className="h-3 w-3" /> {post.likes}
        </div>
      </div>

      <div className="px-4 py-3 space-y-3">
        <p className="text-sm text-foreground/90 line-clamp-2">{post.caption}</p>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            className="h-8 gap-1.5"
            asChild
          >
            <a
              href={`https://instagram.com/${post.username}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              <ExternalLink className="h-3.5 w-3.5" /> View
            </a>
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="h-8 gap-1.5"
            onClick={() => postActions.download(post.id)}
            disabled={post.status === "downloaded"}
          >
            <Download className="h-3.5 w-3.5" />
            {post.status === "downloaded" ? "Downloaded" : "Download"}
          </Button>
          <div className="flex-1" />
          {isActioned ? (
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={() => postActions.reset(post.id)}
              title="Reset"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          ) : (
            <>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-success hover:text-success"
                onClick={() => postActions.approve(post.id)}
                title="Approve"
              >
                <Check className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                onClick={() => postActions.ignore(post.id)}
                title="Ignore"
              >
                <X className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}
