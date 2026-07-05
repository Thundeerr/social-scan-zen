import { Check, X, Download, ExternalLink, Heart } from "lucide-react";
import type { Post } from "@/lib/mock-data";
import { Button } from "@/components/ui/button";

export function PostCard({ post }: { post: Post }) {
  return (
    <article className="soft-shadow group rounded-xl border border-border bg-card overflow-hidden hover:border-primary/30 transition-colors">
      <div className="flex items-center gap-3 px-4 py-3">
        <img src={post.avatar} alt="" className="h-8 w-8 rounded-full ring-1 ring-border" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">@{post.username}</div>
          <div className="text-[11px] text-muted-foreground">detected {post.detectedAt}</div>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-primary bg-primary/10 border border-primary/20 rounded-full px-2 py-0.5">
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
          <Button size="sm" variant="secondary" className="h-8 gap-1.5">
            <ExternalLink className="h-3.5 w-3.5" /> View
          </Button>
          <Button size="sm" variant="secondary" className="h-8 gap-1.5">
            <Download className="h-3.5 w-3.5" /> Download
          </Button>
          <div className="flex-1" />
          <Button size="icon" variant="ghost" className="h-8 w-8 text-success hover:text-success">
            <Check className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </article>
  );
}
