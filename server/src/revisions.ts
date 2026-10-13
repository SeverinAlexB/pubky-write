// Version history. Edits are grouped into editing sessions: a revision keeps absorbing
// changes until the document has been idle for SESSION_GAP_MS, then the next edit starts a new one.
import type { Revision, RevisionWithContent } from "@docs/shared";
import type { Database } from "./database.ts";

export const SESSION_GAP_MS = Number(process.env.REVISION_SESSION_GAP_MS ?? 5 * 60 * 1000);

type RevisionRow = {
  id: number;
  version: number;
  content: string;
  started_at: number;
  ended_at: number;
  restored_from: number | null;
};

export function recordRevision(
  db: Database,
  documentId: string,
  version: number,
  content: string,
  now: number,
  restoredFrom: number | null = null,
): void {
  const latest = db
    .prepare("SELECT id, ended_at, restored_from FROM revisions WHERE document_id = ? ORDER BY ended_at DESC, id DESC LIMIT 1")
    .get(documentId) as Pick<RevisionRow, "id" | "ended_at" | "restored_from"> | undefined;

  // A restore always gets its own entry, and so does the first edit after one.
  const continuesSession =
    latest !== undefined && restoredFrom === null && latest.restored_from === null && now - latest.ended_at < SESSION_GAP_MS;

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
    .prepare(
      "SELECT id, version, started_at, ended_at, restored_from FROM revisions WHERE document_id = ? ORDER BY ended_at DESC, id DESC",
    )
    .all(documentId) as Omit<RevisionRow, "content">[];
  return rows.map(toRevision);
}

export function getRevision(db: Database, documentId: string, revisionId: number): RevisionWithContent | null {
  const row = db
    .prepare("SELECT id, version, content, started_at, ended_at, restored_from FROM revisions WHERE document_id = ? AND id = ?")
    .get(documentId, revisionId) as RevisionRow | undefined;
  return row ? { ...toRevision(row), content: JSON.parse(row.content) } : null;
}

function toRevision(row: Omit<RevisionRow, "content">): Revision {
  return {
    id: row.id,
    version: row.version,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    restoredFrom: row.restored_from,
  };
}
