// npm run backup: writes backups/<timestamp>/ with docs.sqlite and uploads/, keeping the last 20.
// DATA_DIR and BACKUP_DIR override the default data/ and backups/ directories.
import { join, resolve } from "node:path";
import { createBackup } from "./backup.ts";

const repoRoot = resolve(import.meta.dirname, "../..");
const dataDir = resolve(process.env.DATA_DIR ?? join(repoRoot, "data"));
const backupsDir = resolve(process.env.BACKUP_DIR ?? join(repoRoot, "backups"));

try {
  const { path, removed } = createBackup({ dataDir, backupsDir });
  console.log(`Backed up ${dataDir} to ${path}`);
  if (removed.length > 0) console.log(`Removed ${removed.length} older backup${removed.length === 1 ? "" : "s"}`);
} catch (error) {
  console.error(`Backup failed: ${(error as Error).message}`);
  process.exitCode = 1;
}
