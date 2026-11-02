import { ArrowUpRight, Link2, MousePointer2, type LucideIcon } from "lucide-react";

/** Original inline SVG; inherits the app palette and never loads remote assets. */
export function StudioEmptyState({
  title,
  description,
  icon: Icon = Link2,
}: {
  title: string;
  description: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="studio-empty-state mx-auto flex max-w-md flex-col items-center px-5 py-10 text-center">
      <div className="relative mb-5 h-28 w-48" aria-hidden="true">
        <svg
          viewBox="0 0 192 112"
          className="absolute inset-0 h-full w-full text-primary"
          fill="none"
        >
          <path
            d="M10 72C-5 24 44 9 76 15s60-8 88 20 11 65-24 69S24 115 10 72Z"
            fill="currentColor"
            opacity=".07"
          />
          <path
            d="M20 79h151M35 36h120"
            stroke="currentColor"
            strokeDasharray="3 7"
            opacity=".25"
          />
          <rect
            x="43"
            y="25"
            width="108"
            height="65"
            rx="12"
            fill="var(--card)"
            stroke="var(--border)"
          />
          <path
            d="M57 39h27M57 48h49"
            stroke="var(--muted-foreground)"
            strokeWidth="3"
            strokeLinecap="round"
            opacity=".45"
          />
          <rect x="57" y="62" width="59" height="13" rx="5" fill="currentColor" opacity=".14" />
          <circle cx="151" cy="27" r="16" fill="var(--card)" stroke="var(--border)" />
        </svg>
        <Icon className="absolute right-8 top-[19px] size-4 text-primary" strokeWidth={1.6} />
        <MousePointer2
          className="absolute bottom-3 right-9 size-7 text-primary"
          fill="var(--card)"
          strokeWidth={1.5}
        />
      </div>
      <h3 className="font-display text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
      <ArrowUpRight aria-hidden="true" className="mt-4 size-4 text-primary/70" />
    </div>
  );
}
