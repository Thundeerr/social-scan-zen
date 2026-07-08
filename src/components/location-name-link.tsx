import { ExternalLink, Info } from "lucide-react";
import { instagramLocationUrl } from "@/lib/instagram-links";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type Props = {
  locationId: string | null | undefined;
  name: string;
  className?: string;
  showExternalIcon?: boolean;
};

/**
 * Renders a location name as a link to Instagram when the location_id is a
 * valid numeric IG place id. Falls back to a plain span with a tooltip
 * explaining why the link is unavailable — never a broken href.
 */
export function LocationNameLink({
  locationId,
  name,
  className,
  showExternalIcon = false,
}: Props) {
  const url = instagramLocationUrl(locationId);
  const baseCls = "text-sm font-medium " + (className ?? "");

  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className={
          baseCls +
          " group/loclink inline-flex items-center gap-1 hover:underline hover:text-primary transition-colors"
        }
        title="Open on Instagram"
      >
        <span className="truncate">{name}</span>
        <ExternalLink
          className={
            "h-3 w-3 shrink-0 transition-opacity " +
            (showExternalIcon
              ? "opacity-60"
              : "opacity-0 group-hover/loclink:opacity-70 group-focus-visible/loclink:opacity-70")
          }
          aria-hidden
        />
      </a>
    );
  }

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={
              baseCls +
              " inline-flex items-center gap-1 text-muted-foreground/90 cursor-help"
            }
          >
            <span className="truncate">{name}</span>
            <Info className="h-3 w-3 shrink-0 opacity-60" aria-hidden />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          No Instagram location link available — the tracked ID is missing or
          not a valid Instagram place identifier.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
