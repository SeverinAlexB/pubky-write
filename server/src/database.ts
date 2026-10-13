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
      restored_from INTEGER,
      name          TEXT -- set by "Name this version"; a named revision stops absorbing edits
    );
    CREATE INDEX IF NOT EXISTS revisions_by_document ON revisions (document_id, ended_at);

    -- A comment thread anchored to a range of the document. The anchor moves with every
    -- accepted step; when its text is deleted it collapses (anchor_from = anchor_to).
    CREATE TABLE IF NOT EXISTS comments (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id TEXT    NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      anchor_from INTEGER NOT NULL,
      anchor_to   INTEGER NOT NULL,
      quote       TEXT    NOT NULL, -- the commented text when the thread was started
      resolved    INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS comments_by_document ON comments (document_id);

    -- The first message of a thread is the comment itself; later ones are replies.
    CREATE TABLE IF NOT EXISTS comment_messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
      body       TEXT    NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  // Databases created before versions could be named.
  const revisionColumns = db.prepare("PRAGMA table_info(revisions)").all() as { name: string }[];
  if (!revisionColumns.some((column) => column.name === "name")) db.exec("ALTER TABLE revisions ADD COLUMN name TEXT");
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
