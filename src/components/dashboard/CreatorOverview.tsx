import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  CheckCheck,
  Clapperboard,
  FolderHeart,
  Inbox,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  pendingCount?: number;
  reviewLoading: boolean;
  reviewError: boolean;
  onRetry: () => void;
};

export function CreatorOverview({ pendingCount, reviewLoading, reviewError, onRetry }: Props) {
  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium tracking-[0.16em] text-primary">
            MIDNA // CONTENT DESK
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Your content desk
          </h1>
          <p className="mt-3 text-base text-muted-foreground">
            Find a source. Review your video. Prepare your next post.
          </p>
        </div>
        <span className="rounded-full border border-border bg-card px-4 py-2 text-sm text-muted-foreground">
          Kiikii & Tuuva
        </span>
      </header>
      <section
        aria-labelledby="next-step"
        className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card p-6 sm:p-8"
      >
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-xl">
            <p className="text-sm font-medium text-primary">Your next step</p>
            <h2 id="next-step" className="mt-2 text-2xl font-semibold tracking-tight">
              {reviewLoading
                ? "Loading your reviews …"
                : reviewError
                  ? "Review status is unavailable"
                  : pendingCount
                    ? `${pendingCount} ${pendingCount === 1 ? "video needs" : "videos need"} your okay`
                    : "Ready for your next video?"}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {reviewError
                ? "Open the review page to check your videos directly."
                : pendingCount
                  ? "Check the video and caption. You decide what gets posted. Based on your latest 100 reviews."
                  : "Choose a source and a character. Your results appear in Review & publish."}
            </p>
            {reviewError && (
              <Button variant="link" className="mt-2 min-h-11 px-0" onClick={onRetry}>
                Try again
              </Button>
            )}
          </div>
          <div className="flex shrink-0 flex-col gap-3 sm:flex-row lg:flex-col">
            <Button size="lg" className="min-h-14 gap-3 rounded-xl px-6 text-base" asChild>
              <Link to="/content-review">
                <CheckCheck className="h-5 w-5" />
                Review videos
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="min-h-12 gap-2 rounded-xl bg-background/40 px-6"
              asChild
            >
              <Link to="/generate">
                <Clapperboard className="h-4 w-4" />
                Create video
              </Link>
            </Button>
          </div>
        </div>
      </section>
      <section aria-labelledby="workflow-title">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id="workflow-title" className="text-lg font-semibold">
            Your daily workflow
          </h2>
          <span className="hidden text-sm text-muted-foreground sm:block">
            One click to each step
          </span>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <WorkflowCard
            to="/reel-inbox"
            step="01"
            icon={Inbox}
            title="Collect ideas"
            description="Reels from your links and Instagram DMs."
            action="Open reel inbox"
          />
          <WorkflowCard
            to="/generate"
            step="02"
            icon={Clapperboard}
            title="Create video"
            description="Pick your source and character, then start a job."
            action="Start creating"
          />
          <WorkflowCard
            to="/content-review"
            step="03"
            icon={CheckCheck}
            title="Review & publish"
            description="Check the video and caption, then prepare your post."
            action="Open your videos"
          />
        </div>
      </section>
      <section aria-label="Library and business" className="grid gap-4 md:grid-cols-2">
        <QuickLink
          to="/catalogue"
          icon={FolderHeart}
          title="My videos & bundles"
          description="Your library, content assignments and bundles."
        />
        <QuickLink
          to="/business"
          icon={Wallet}
          title="Revenue & costs"
          description="Revenue, expenses and profit at a glance."
        />
      </section>
    </>
  );
}

function WorkflowCard({
  to,
  step,
  icon: Icon,
  title,
  description,
  action,
}: {
  to: "/reel-inbox" | "/generate" | "/content-review";
  step: string;
  icon: LucideIcon;
  title: string;
  description: string;
  action: string;
}) {
  return (
    <Link
      to={to}
      className="group flex min-h-60 flex-col rounded-2xl border border-border bg-card p-6 transition-colors hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div className="mb-5 flex items-center justify-between">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </span>
        <span aria-hidden="true" className="font-mono text-sm text-muted-foreground">
          {step}
        </span>
      </div>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
      <div className="mt-auto flex items-center justify-between gap-3 pt-6 text-sm font-medium text-primary">
        {action}
        <ArrowRight className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-1" />
      </div>
    </Link>
  );
}

function QuickLink({
  to,
  icon: Icon,
  title,
  description,
}: {
  to: "/catalogue" | "/business";
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <Link
      to={to}
      className="group flex items-center gap-4 rounded-2xl border border-border bg-card/70 p-5 transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <Icon className="h-5 w-5 shrink-0 text-primary" />
      <div className="flex-1">
        <h2 className="font-semibold">{title}</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1" />
    </Link>
  );
}
