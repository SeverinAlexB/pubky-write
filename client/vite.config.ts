import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiServer = `http://localhost:${process.env.API_PORT ?? 3001}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.PORT ?? 5173),
    strictPort: true,
    proxy: {
      "/api": apiServer,
      "/uploads": apiServer,
    },
  },
});
