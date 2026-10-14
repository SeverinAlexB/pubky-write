import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiServer = `http://localhost:${process.env.API_PORT ?? 3001}`;

export default defineConfig({
  plugins: [react()],
  // Scan every module at startup, not only the entry: dependencies of lazily loaded parts
  // would otherwise be found on first use, and re-bundling them reloads the page.
  optimizeDeps: { entries: ["index.html", "src/**/*.{ts,tsx}", "!src/**/*.test.ts"] },
  server: {
    port: Number(process.env.PORT ?? 5173),
    strictPort: true,
    proxy: {
      "/api": apiServer,
      "/uploads": apiServer,
    },
  },
});
