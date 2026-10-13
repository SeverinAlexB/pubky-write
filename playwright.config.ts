import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

// Separate ports and a throwaway data directory so tests never touch real documents.
const apiPort = 3101;
const webPort = 5273;
const dataDir = join(tmpdir(), `docs-e2e-${process.pid}`);

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${webPort}`,
    // Uses the installed Chrome instead of downloading a browser.
    channel: "chrome",
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      // A short session gap lets the version history test create separate versions quickly.
      command: `DATA_DIR=${dataDir} PORT=${apiPort} REVISION_SESSION_GAP_MS=1000 npx tsx server/src/index.ts`,
      url: `http://localhost:${apiPort}/api/documents`,
      reuseExistingServer: false,
    },
    {
      command: `API_PORT=${apiPort} PORT=${webPort} npm run dev -w client`,
      url: `http://localhost:${webPort}`,
      reuseExistingServer: false,
    },
  ],
});
