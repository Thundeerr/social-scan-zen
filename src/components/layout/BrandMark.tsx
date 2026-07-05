import { cn } from "@/lib/utils";

/**
 * Militech-style reticle brand mark.
 * A stenciled "I" locked inside a targeting reticle — matches the favicon.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
        "bg-primary/10 ring-1 ring-primary/40",
        "shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.15)]",
        className,
      )}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 32 32"
        className="h-5 w-5 text-primary"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="square"
      >
        {/* Outer reticle ring */}
        <circle cx="16" cy="16" r="11" opacity="0.55" />
        {/* Crosshair ticks */}
        <path d="M16 2.5 V6 M16 26 V29.5 M2.5 16 H6 M26 16 H29.5" opacity="0.75" />
        {/* Inner corner brackets */}
        <path
          d="M9 11 V9 H11 M21 9 H23 V11 M23 21 V23 H21 M11 23 H9 V21"
          opacity="0.6"
        />
        {/* Stenciled I */}
        <path
          d="M12.5 10.5 H19.5 M12.5 21.5 H19.5 M16 10.5 V21.5"
          strokeWidth="2"
          strokeLinecap="butt"
        />
        {/* Center pip */}
        <circle cx="16" cy="16" r="0.9" fill="currentColor" stroke="none" />
      </svg>
    </div>
  );
}
