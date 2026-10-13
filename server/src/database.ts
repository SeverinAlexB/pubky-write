import { DatabaseSync } from "node:sqlite";

export type Database = DatabaseSync;

/** Opens (or creates) the database. Pass ":memory:" for tests. */
export function openDatabase(path: string): Database {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS documents (
      id             TEXT PRIMARY KEY,
      title          TEXT    NOT NULL,
      content        TEXT    NOT NULL, -- ProseMirror JSON
      plain_text     TEXT    NOT NULL, -- for search
      version        INTEGER NOT NULL,
      created_at     INTEGER NOT NULL,
      updated_at     INTEGER NOT NULL,
      last_opened_at INTEGER NOT NULL
    );

    -- Every accepted step, so clients that fall behind can catch up.
    CREATE TABLE IF NOT EXISTS steps (
      document_id TEXT    NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      version     INTEGER NOT NULL, -- document version after this step
      step        TEXT    NOT NULL,
      client_id   TEXT    NOT NULL,
      PRIMARY KEY (document_id, version)
    );

    -- One row per editing session; see revisions.ts.
    CREATE TABLE IF NOT EXISTS revisions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id   TEXT    NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      version       INTEGER NOT NULL,
      content       TEXT    NOT NULL,
      started_at    INTEGER NOT NULL,
      ended_at      INTEGER NOT NULL,
      restored_from INTEGER
    );
    CREATE INDEX IF NOT EXISTS revisions_by_document ON revisions (document_id, ended_at);
  `);
  return db;
}

export function inTransaction<T>(db: Database, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
