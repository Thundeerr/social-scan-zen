import type { ReactNode } from "react";
import { AppSidebar } from "./AppSidebar";
import { TopBar } from "./TopBar";
import { useScanSimulator } from "@/lib/scan-simulator";
import { AnimatedCircuitBackground } from "@/components/AnimatedCircuitBackground";

export function AppShell({ children }: { children: ReactNode }) {
  useScanSimulator();
  return (
    <div className="relative flex min-h-screen w-full bg-background text-foreground">
      <AnimatedCircuitBackground />
      <div className="relative z-[1] flex w-full min-h-screen">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <TopBar />
          <main className="flex-1 min-w-0">{children}</main>
        </div>
      </div>
    </div>
  );
}
