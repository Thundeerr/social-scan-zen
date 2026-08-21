import { useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  CheckCircle2,
  CircleDashed,
  FlaskConical,
  Hand,
  ShieldCheck,
  SkipForward,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ReviewablePost } from "./content-review-dialog";
import { buildPublisherDryRun, type PreflightCheck } from "@/lib/publisher-preflight";

export function PublisherDryRunPanel({ post }: { post: ReviewablePost }) {
  const [hasRun, setHasRun] = useState(false);
  const result = buildPublisherDryRun(post);

  return (
    <section className="rounded-lg border border-border/70 bg-background/45 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium">
            <FlaskConical className="h-4 w-4 text-primary" /> Publishing dry run
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Simulates the exact order and checks the stored package. No Instagram or database write
            is performed.
          </p>
        </div>
        <Button
          type="button"
          variant={hasRun ? "outline" : "default"}
          size="sm"
          onClick={() => {
            setHasRun(true);
            if (result.ready) toast.success("Dry run passed · nothing was published");
            else
              toast.error(
                `${result.blockers.length} blocker${result.blockers.length === 1 ? "" : "s"} found`,
              );
          }}
        >
          <FlaskConical className="mr-1.5 h-3.5 w-3.5" /> {hasRun ? "Run again" : "Run dry check"}
        </Button>
      </div>

      {hasRun && (
        <div className="mt-4 space-y-4">
          <div
            className={`rounded-md border px-3 py-2.5 ${
              result.ready
                ? "border-emerald-500/25 bg-emerald-500/[0.07]"
                : "border-red-500/25 bg-red-500/[0.07]"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-medium">
                {result.ready ? (
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-red-400" />
                )}
                {result.ready ? "Safe to approve" : "Approval must stay blocked"}
              </div>
              <Badge variant="outline">
                {result.checks.length - result.blockers.length}/{result.checks.length} non-blocking
              </Badge>
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Simulated order
            </div>
            <div className="mt-2 space-y-1.5">
              {result.steps.map((step, index) => (
                <div key={step.channel}>
                  <div className="flex items-start gap-3 rounded-md border border-border/60 px-3 py-2.5">
                    <StepIcon state={step.state} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
                        {step.label}
                        <Badge variant="outline" className="text-[9px] uppercase">
                          {step.state}
                        </Badge>
                      </div>
                      <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                        {step.detail}
                      </p>
                    </div>
                  </div>
                  {index < result.steps.length - 1 && (
                    <ArrowDown className="mx-auto my-1 h-3 w-3 text-muted-foreground/60" />
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Preflight checks
            </div>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {result.checks.map((check) => (
                <CheckRow key={check.code} check={check} />
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function StepIcon({ state }: { state: "ready" | "blocked" | "skipped" | "manual" }) {
  if (state === "ready")
    return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />;
  if (state === "manual") return <Hand className="mt-0.5 h-4 w-4 shrink-0 text-primary" />;
  if (state === "skipped")
    return <SkipForward className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />;
  return <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />;
}

function CheckRow({ check }: { check: PreflightCheck }) {
  const icon =
    check.state === "pass" ? (
      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
    ) : check.state === "blocker" ? (
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
    ) : check.state === "manual" ? (
      <Hand className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
    ) : (
      <CircleDashed className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
    );
  return (
    <div className="flex items-start gap-2 rounded-md border border-border/50 px-2.5 py-2">
      {icon}
      <div className="min-w-0">
        <div className="text-[10px] font-medium">{check.label}</div>
        <div className="mt-0.5 text-[9px] leading-3.5 text-muted-foreground">{check.detail}</div>
      </div>
    </div>
  );
}
