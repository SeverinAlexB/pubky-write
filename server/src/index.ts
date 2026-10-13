import { existsSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { openDatabase } from "./database.ts";

const repoRoot = resolve(import.meta.dirname, "../..");
const dataDir = resolve(process.env.DATA_DIR ?? join(repoRoot, "data"));
const port = Number(process.env.PORT ?? 3001);
const clientDist = join(repoRoot, "client/dist");

mkdirSync(dataDir, { recursive: true });
const db = openDatabase(join(dataDir, "docs.sqlite"));
const app = createApp({ db, uploadsDir: join(dataDir, "uploads") });

// In production the server also hosts the built client; in development Vite does.
if (process.env.NODE_ENV === "production" && existsSync(clientDist)) {
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
  };
  app.get("*", async (c) => {
    const path = join(clientDist, c.req.path);
    const isAsset = path.startsWith(clientDist) && extname(path) !== "" && existsSync(path);
    const file = isAsset ? path : join(clientDist, "index.html");
    return c.body(new Uint8Array(await readFile(file)), 200, {
      "Content-Type": types[extname(file)] ?? "application/octet-stream",
    });
  });
}

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Server listening on http://localhost:${info.port} (data in ${dataDir})`);
});
