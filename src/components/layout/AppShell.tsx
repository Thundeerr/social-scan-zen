import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppSidebar } from "./AppSidebar";
import { TopBar } from "./TopBar";
import { useScanSimulator } from "@/lib/scan-simulator";
import { AnimatedCircuitBackground } from "@/components/AnimatedCircuitBackground";
import { KeyboardShortcuts } from "@/lib/keyboard-shortcuts";
import { CommandPalette } from "@/components/command-palette";
import { DownloadProgressPanel } from "@/components/download-progress-panel";

export function AppShell({ children }: { children: ReactNode }) {
  useScanSimulator();
  return (
    <TooltipProvider delayDuration={200}>
      <div className="relative flex min-h-screen w-full bg-background text-foreground">
        <a
          href="#main-content"
          className="sr-only fixed left-4 top-4 z-50 rounded-xl bg-primary px-4 py-3 font-medium text-primary-foreground focus:not-sr-only"
        >
          Skip to content
        </a>
        <div
          className="pointer-events-none absolute inset-0 opacity-10 motion-reduce:hidden"
          aria-hidden="true"
        >
          <AnimatedCircuitBackground />
        </div>
        <div className="relative z-[1] flex w-full min-h-screen">
          <AppSidebar />
          <div className="flex-1 flex flex-col min-w-0">
            <TopBar />
            <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 focus:outline-none">
              {children}
            </main>
          </div>
        </div>
        <KeyboardShortcuts />
        <CommandPalette />
        <DownloadProgressPanel />
      </div>
    </TooltipProvider>
  );
}
