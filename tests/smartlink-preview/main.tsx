import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { SmartlinkStudio } from "@/components/smartlink-studio";
import "@/styles.css";
const mode = new URLSearchParams(location.search).get("mode") || "analytics";
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <main style={{ maxWidth: 1440, margin: "0 auto", padding: 24 }}>
      <div style={{ fontSize: 11, color: "#a1a1aa", marginBottom: 20 }}>
        INSTASCANNER / UI-TESTVORSCHAU · SYNTHETISCHE BEISPIELDATEN
      </div>
      <SmartlinkStudio mode={mode as "links" | "campaigns" | "analytics"} />
      <Toaster theme="dark" />
    </main>
  </QueryClientProvider>,
);
