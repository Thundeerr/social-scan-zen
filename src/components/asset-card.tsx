import { Check, X, Download, ExternalLink, Heart, RotateCcw } from "lucide-react";
import type { Asset } from "@/lib/mock-data";
import { Button } from "@/components/ui/button";
import { assetActions } from "@/lib/assets-store";
import { cn } from "@/lib/utils";

const statusStyles: Record<Asset["status"], string> = {
  new: "text-primary bg-primary/10 border-primary/20",
  approved: "text-success bg-success/10 border-success/30",
  ignored: "text-muted-foreground bg-muted/40 border-border",
  downloaded: "text-foreground bg-foreground/10 border-foreground/20",
};

const statusLabel: Record<Asset["status"], string> = {
  new: "new",
  approved: "approved",
  ignored: "archived",
  downloaded: "synchronized",
};

export function AssetCard({ asset }: { asset: Asset }) {
  const isActioned = asset.status !== "new";

  return (
    <article className="soft-shadow group rounded-xl border border-border bg-card overflow-hidden hover:border-primary/30 transition-colors">
      <div className="flex items-center gap-3 px-4 py-3">
        <img src={asset.avatar} alt="" className="h-8 w-8 rounded-full ring-1 ring-border" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">@{asset.username}</div>
          <div className="text-[11px] text-muted-foreground">detected {asset.detectedAt}</div>
        </div>
        <span
          className={cn(
            "text-[10px] uppercase tracking-wider border rounded-full px-2 py-0.5 capitalize",
            statusStyles[asset.status],
          )}
        >
          {statusLabel[asset.status]}
        </span>
      </div>

      <div className="relative aspect-square overflow-hidden bg-muted">
        <img
          src={asset.thumbnail}
          alt=""
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
          loading="lazy"
        />
        <div className="absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-black/60 backdrop-blur px-2 py-0.5 text-[10px] text-white">
          <Heart className="h-3 w-3" /> {asset.likes}
        </div>
      </div>

      <div className="px-4 py-3 space-y-3">
        <p className="text-sm text-foreground/90 line-clamp-2">{asset.caption}</p>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            className="h-8 gap-1.5"
            asChild
          >
            <a
              href={`https://instagram.com/${asset.username}`}
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
            onClick={() => assetActions.download(asset.id)}
            disabled={asset.status === "downloaded"}
          >
            <Download className="h-3.5 w-3.5" />
            {asset.status === "downloaded" ? "Synchronized" : "Sync"}
          </Button>
          <div className="flex-1" />
          {isActioned ? (
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={() => assetActions.reset(asset.id)}
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
                onClick={() => assetActions.approve(asset.id)}
                title="Approve asset"
              >
                <Check className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                onClick={() => assetActions.ignore(asset.id)}
                title="Archive asset"
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
