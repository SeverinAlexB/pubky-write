import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBackup, listBackups } from "./backup.ts";
import { openDatabase, type Database } from "./database.ts";
import { createDocument } from "./documents.ts";

let root: string;
let dataDir: string;
let backupsDir: string;
let db: Database;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "docs-backup-"));
  dataDir = join(root, "data");
  backupsDir = join(root, "backups");
  mkdirSync(join(dataDir, "uploads"), { recursive: true });
  db = openDatabase(join(dataDir, "docs.sqlite"));
});

afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

describe("createBackup", () => {
  it("copies the database, including changes still in the WAL, and the uploads while the database is open", () => {
    createDocument(db, "Backed up");
    writeFileSync(join(dataDir, "uploads", "image.png"), "png");

    const { path } = createBackup({ dataDir, backupsDir, now: new Date("2026-10-14T07:50:12.345Z") });

    expect(path).toBe(join(backupsDir, "2026-10-14T07-50-12-345Z"));
    const copy = new DatabaseSync(join(path, "docs.sqlite"), { readOnly: true });
    expect(copy.prepare("SELECT title FROM documents").all()).toEqual([{ title: "Backed up" }]);
    copy.close();
    expect(readFileSync(join(path, "uploads", "image.png"), "utf8")).toBe("png");
  });

  it("keeps only the newest backups", () => {
    for (let i = 0; i < 4; i++) createBackup({ dataDir, backupsDir, keep: 2, now: new Date(Date.UTC(2026, 0, 1, 0, 0, i)) });
    expect(listBackups(backupsDir)).toEqual(["2026-01-01T00-00-02-000Z", "2026-01-01T00-00-03-000Z"]);
  });

  it("fails without a database and leaves no partial backup", () => {
    expect(() => createBackup({ dataDir: join(root, "missing"), backupsDir })).toThrow(/No database/);
    expect(listBackups(backupsDir)).toEqual([]);
  });
});
