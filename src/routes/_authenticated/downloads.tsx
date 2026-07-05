import { createFileRoute, Link } from "@tanstack/react-router";
import { Download, Images } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/downloads")({
  head: () => ({ meta: [{ title: "Downloads — InstaScanner" }] }),
  component: DownloadsPage,
});

function DownloadsPage() {
  return (
    <div className="p-6 md:p-8 h-full">
      <div className="soft-shadow rounded-2xl border border-border bg-card min-h-[70vh] flex items-center justify-center">
        <div className="max-w-sm text-center px-6 py-16">
          <div className="relative mx-auto mb-6 h-24 w-24">
            <div className="absolute inset-0 rounded-3xl bg-primary/10 blur-2xl" />
            <div className="relative flex h-full w-full items-center justify-center rounded-3xl bg-gradient-to-br from-primary/20 to-primary/5 ring-1 ring-primary/20">
              <Download className="h-10 w-10 text-primary" />
            </div>
          </div>
          <h2 className="text-lg font-semibold tracking-tight">Archive is empty</h2>
          <p className="text-sm text-muted-foreground mt-2">
            Synchronized assets will appear here, organized by account and date.
          </p>
          <div className="mt-6 flex items-center justify-center gap-2">
            <Button asChild variant="secondary" className="gap-1.5">
              <Link to="/assets" search={{ day: "all", status: "all" }}>
                <Images className="h-4 w-4" /> Review new assets
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
