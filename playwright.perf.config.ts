import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

// Performance measurements run against the production build (minified, React in production
// mode), served by the API server on its own port with a throwaway data directory.
const port = 3201;
const dataDir = join(tmpdir(), `docs-perf-${process.pid}`);

export default defineConfig({
  testDir: "e2e",
  testMatch: "perf.spec.ts",
  workers: 1,
  reporter: "list",
  timeout: 300_000,
  use: {
    baseURL: `http://localhost:${port}`,
    channel: "chrome",
    locale: "en-GB",
    headless: true,
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: `npm run build && NODE_ENV=production DATA_DIR=${dataDir} PORT=${port} npx tsx server/src/index.ts`,
    url: `http://localhost:${port}/api/documents`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
