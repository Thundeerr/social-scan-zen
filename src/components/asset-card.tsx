import { Check, X, Download, ExternalLink, Heart, RotateCcw, Star } from "lucide-react";
import type { Asset } from "@/lib/mock-data";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { assetActions } from "@/lib/assets-store";
import { useFavorites, toggleFavorite } from "@/lib/favorites-store";
import { selectAsset, useSelection } from "@/lib/selection-store";
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

function ShortcutHint({ children }: { children: string }) {
  return (
    <span className="ml-1.5 inline-flex items-center rounded border border-white/20 bg-white/10 px-1 font-mono text-[9px] tracking-wider">
      {children}
    </span>
  );
}

export function AssetCard({ asset }: { asset: Asset }) {
  const isActioned = asset.status !== "new";
  const { selectedId } = useSelection();
  const favorites = useFavorites();
  const selected = selectedId === asset.id;
  const isFav = favorites.has(asset.id);
  const sourceUrl = `https://instagram.com/${asset.username}`;

  return (
    <article
      data-asset-id={asset.id}
      data-asset-url={sourceUrl}
      onClick={() => selectAsset(asset.id)}
      className={cn(
        "soft-shadow group rounded-xl border bg-card overflow-hidden transition-colors cursor-pointer",
        selected
          ? "border-primary/60 ring-1 ring-primary/40"
          : "border-border hover:border-primary/30",
      )}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <img src={asset.avatar} alt="" className="h-8 w-8 rounded-full ring-1 ring-border" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-sm font-medium truncate">@{asset.username}</span>
            {isFav && <Star className="h-3 w-3 fill-warning text-warning shrink-0" />}
          </div>
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
        {selected && (
          <div className="absolute top-2 left-2 rounded-md bg-primary/90 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider text-primary-foreground">
            Selected
          </div>
        )}
      </div>

      <div className="px-4 py-3 space-y-3">
        <p className="text-sm text-foreground/90 line-clamp-2">{asset.caption}</p>
        <div className="flex items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" variant="secondary" className="h-8 gap-1.5" asChild>
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Open
                </a>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Open original source <ShortcutHint>R</ShortcutHint>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="secondary"
                className="h-8 gap-1.5"
                onClick={(e) => {
                  e.stopPropagation();
                  assetActions.download(asset.id);
                }}
                disabled={asset.status === "downloaded"}
              >
                <Download className="h-3.5 w-3.5" />
                {asset.status === "downloaded" ? "Synced" : "Sync"}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Synchronize asset <ShortcutHint>D</ShortcutHint>
            </TooltipContent>
          </Tooltip>

          <div className="flex-1" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className={cn(
                  "h-8 w-8",
                  isFav ? "text-warning" : "text-muted-foreground hover:text-warning",
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFavorite(asset.id);
                }}
              >
                <Star className={cn("h-4 w-4", isFav && "fill-warning")} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Toggle favorite <ShortcutHint>F</ShortcutHint>
            </TooltipContent>
          </Tooltip>

          {isActioned ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    assetActions.reset(asset.id);
                  }}
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Reset to new</TooltipContent>
            </Tooltip>
          ) : (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-success hover:text-success"
                    onClick={(e) => {
                      e.stopPropagation();
                      assetActions.approve(asset.id);
                    }}
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Approve asset <ShortcutHint>A</ShortcutHint>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      assetActions.ignore(asset.id);
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Archive asset <ShortcutHint>I</ShortcutHint>
                </TooltipContent>
              </Tooltip>
            </>
          )}
        </div>
      </div>
    </article>
  );
}
