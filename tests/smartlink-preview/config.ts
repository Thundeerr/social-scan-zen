import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
const local = (s: string) => fileURLToPath(new URL(s, import.meta.url));
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: ".smartlink-temp/preview", rollupOptions: { input: local("./index.html") } },
  resolve: {
    alias: [
      { find: "@/lib/smartlinks.functions", replacement: local("./mock.tsx") },
      { find: "@tanstack/react-start", replacement: local("./mock.tsx") },
      { find: "@tanstack/react-router", replacement: local("./mock.tsx") },
      { find: "@", replacement: local("../../src") },
    ],
  },
  server: { host: "127.0.0.1", port: 4178, strictPort: true },
});
