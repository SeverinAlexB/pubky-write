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
      last_opened_at INTEGER NOT NULL,
      preview        TEXT -- the top of the first page as JSON, for thumbnails (see preview.ts)
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

    -- Emoji reactions to comment messages (spec 20): one row per user and emoji. Every reaction is
    -- by the one local user ("You") for now.
    CREATE TABLE IF NOT EXISTS comment_reactions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL REFERENCES comment_messages(id) ON DELETE CASCADE,
      emoji      TEXT    NOT NULL,
      user       TEXT    NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE (message_id, emoji, user)
    );

    -- Replies on a suggestion (see docs/design/suggesting.md). The suggestion itself lives in the
    -- document content; replies of suggestions that are gone are kept, so undo brings them back.
    CREATE TABLE IF NOT EXISTS suggestion_replies (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id   TEXT    NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      suggestion_id TEXT    NOT NULL,
      body          TEXT    NOT NULL,
      created_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS suggestion_replies_by_document ON suggestion_replies (document_id, suggestion_id);

    -- Editor sessions whose kept edits another session restored: batches they still send are
    -- refused, so none of their steps can land after the restore (see documents.ts, endSession).
    CREATE TABLE IF NOT EXISTS ended_sessions (
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      client_id   TEXT NOT NULL,
      PRIMARY KEY (document_id, client_id)
    );
  `);
  // Databases created before versions could be named.
  const revisionColumns = db.prepare("PRAGMA table_info(revisions)").all() as { name: string }[];
  if (!revisionColumns.some((column) => column.name === "name")) db.exec("ALTER TABLE revisions ADD COLUMN name TEXT");
  // Databases created before thumbnails: their previews are made on first request.
  const documentColumns = db.prepare("PRAGMA table_info(documents)").all() as { name: string }[];
  if (!documentColumns.some((column) => column.name === "preview")) db.exec("ALTER TABLE documents ADD COLUMN preview TEXT");
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
