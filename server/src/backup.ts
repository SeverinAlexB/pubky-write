// Snapshots of the data directory: the SQLite database and the uploaded images.
//
// `VACUUM INTO` writes a consistent copy of the database from one read transaction, so it is
// safe while the server is running and writing (the database is in WAL mode). Each backup is
// written to a temporary directory first and renamed when complete, so a backup directory
// with a timestamp name is always whole.
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const DATABASE_FILE = "docs.sqlite";
export const UPLOADS_DIR = "uploads";

/** Backup directories are named by UTC time, e.g. 2026-10-14T07-50-12-345Z, so they sort by age. */
const BACKUP_NAME = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;

export type BackupOptions = {
  dataDir: string;
  backupsDir: string;
  /** How many backups to keep; older ones are deleted after a successful backup. */
  keep?: number;
  now?: Date;
};

export type BackupResult = { path: string; removed: string[] };

export function createBackup({ dataDir, backupsDir, keep = 20, now = new Date() }: BackupOptions): BackupResult {
  const databasePath = join(dataDir, DATABASE_FILE);
  if (!existsSync(databasePath)) throw new Error(`No database at ${databasePath}`);

  const name = now.toISOString().replace(/[:.]/g, "-");
  const target = join(backupsDir, name);
  if (existsSync(target)) throw new Error(`A backup named ${name} already exists`);
  const partial = join(backupsDir, `.${name}.partial`);
  rmSync(partial, { recursive: true, force: true });
  mkdirSync(partial, { recursive: true });

  try {
    const db = new DatabaseSync(databasePath, { readOnly: true });
    try {
      db.prepare("VACUUM INTO ?").run(join(partial, DATABASE_FILE));
    } finally {
      db.close();
    }
    checkIntegrity(join(partial, DATABASE_FILE));

    const uploads = join(dataDir, UPLOADS_DIR);
    if (existsSync(uploads)) cpSync(uploads, join(partial, UPLOADS_DIR), { recursive: true });
    else mkdirSync(join(partial, UPLOADS_DIR));

    renameSync(partial, target);
  } catch (error) {
    rmSync(partial, { recursive: true, force: true });
    throw error;
  }

  return { path: target, removed: pruneBackups(backupsDir, keep) };
}

function checkIntegrity(path: string): void {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const { integrity_check: result } = db.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
    if (result !== "ok") throw new Error(`The backup failed its integrity check: ${result}`);
  } finally {
    db.close();
  }
}

/** Deletes all but the newest `keep` backups and returns the deleted paths. */
export function pruneBackups(backupsDir: string, keep: number): string[] {
  const backups = listBackups(backupsDir);
  const removed = backups.slice(0, Math.max(0, backups.length - keep)).map((name) => join(backupsDir, name));
  for (const path of removed) rmSync(path, { recursive: true, force: true });
  return removed;
}

/** Backup directory names, oldest first. */
export function listBackups(backupsDir: string): string[] {
  if (!existsSync(backupsDir)) return [];
  return readdirSync(backupsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && BACKUP_NAME.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}
