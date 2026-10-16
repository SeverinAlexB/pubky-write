// Version history. Edits are grouped into editing sessions: a revision keeps absorbing
// changes until the document has been idle for SESSION_GAP_MS, then the next edit starts a new one.
import type { Revision, RevisionWithContent } from "@pubky-write/shared";
import type { Database } from "./database.ts";

export const SESSION_GAP_MS = Number(process.env.REVISION_SESSION_GAP_MS ?? 5 * 60 * 1000);
/** Longest version name, in characters. */
const MAX_NAME_LENGTH = 100;

type RevisionRow = {
  id: number;
  version: number;
  content: string;
  started_at: number;
  ended_at: number;
  restored_from: number | null;
  name: string | null;
};

const revisionColumns = "id, version, started_at, ended_at, restored_from, name";

export function recordRevision(
  db: Database,
  documentId: string,
  version: number,
  content: string,
  now: number,
  restoredFrom: number | null = null,
): void {
  const latest = latestRow(db, documentId);

  // A restore always gets its own entry, and so does the first edit after one or after naming a version.
  const continuesSession =
    latest !== undefined &&
    restoredFrom === null &&
    latest.restored_from === null &&
    latest.name === null &&
    now - latest.ended_at < SESSION_GAP_MS;

  if (continuesSession) {
    db.prepare("UPDATE revisions SET version = ?, content = ?, ended_at = ? WHERE id = ?").run(version, content, now, latest.id);
  } else {
    db.prepare(
      "INSERT INTO revisions (document_id, version, content, started_at, ended_at, restored_from) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(documentId, version, content, now, now, restoredFrom);
  }
}

export function listRevisions(db: Database, documentId: string): Revision[] {
  const rows = db
    .prepare(`SELECT ${revisionColumns} FROM revisions WHERE document_id = ? ORDER BY ended_at DESC, id DESC`)
    .all(documentId) as Omit<RevisionRow, "content">[];
  return rows.map(toRevision);
}

export function getRevision(db: Database, documentId: string, revisionId: number): RevisionWithContent | null {
  const row = db
    .prepare(`SELECT ${revisionColumns}, content FROM revisions WHERE document_id = ? AND id = ?`)
    .get(documentId, revisionId) as RevisionRow | undefined;
  return row ? { ...toRevision(row), content: JSON.parse(row.content) } : null;
}

/** Names a version, or removes its name when `name` is blank. */
export function nameRevision(db: Database, documentId: string, revisionId: number, name: string): Revision | null {
  db.prepare("UPDATE revisions SET name = ? WHERE document_id = ? AND id = ?").run(normalizeName(name), documentId, revisionId);
  const revision = getRevision(db, documentId, revisionId);
  if (!revision) return null;
  const { content: _content, ...summary } = revision;
  return summary;
}

/**
 * File > Version history > Name current version. A document without edits has no version yet,
 * so one is recorded with its current content.
 */
export function nameCurrentRevision(
  db: Database,
  documentId: string,
  current: { version: number; content: string },
  name: string,
  now: number,
): Revision {
  if (!latestRow(db, documentId)) {
    db.prepare(
      "INSERT INTO revisions (document_id, version, content, started_at, ended_at, restored_from) VALUES (?, ?, ?, ?, ?, NULL)",
    ).run(documentId, current.version, current.content, now, now);
  }
  return nameRevision(db, documentId, latestRow(db, documentId)!.id, name)!;
}

function latestRow(db: Database, documentId: string) {
  return db
    .prepare("SELECT id, ended_at, restored_from, name FROM revisions WHERE document_id = ? ORDER BY ended_at DESC, id DESC LIMIT 1")
    .get(documentId) as Pick<RevisionRow, "id" | "ended_at" | "restored_from" | "name"> | undefined;
}

function normalizeName(name: string): string | null {
  return name.trim().slice(0, MAX_NAME_LENGTH) || null;
}

function toRevision(row: Omit<RevisionRow, "content">): Revision {
  return {
    id: row.id,
    version: row.version,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    restoredFrom: row.restored_from,
    name: row.name,
  };
}
