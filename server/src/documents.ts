// Document storage and the step authority. The server applies every batch of steps
// to its copy of the document, so it always holds the authoritative version.
import { randomUUID } from "node:crypto";
import {
  documentSchema,
  emptyDocument,
  type DocumentSort,
  type DocumentSummary,
  type OpenedDocument,
  type StepsConflictResponse,
} from "@docs/shared";
import { Node } from "@tiptap/pm/model";
import { Mapping, Step, Transform } from "@tiptap/pm/transform";
import { listComments, mapComments } from "./comments.ts";
import { inTransaction, type Database } from "./database.ts";
import { getRevision, recordRevision } from "./revisions.ts";

export const UNTITLED = "Untitled document";

type DocumentRow = {
  id: string;
  title: string;
  content: string;
  version: number;
  created_at: number;
  updated_at: number;
  last_opened_at: number;
};

export class InvalidStepsError extends Error {}

export type ApplyStepsResult = { kind: "applied"; version: number } | ({ kind: "conflict" } & StepsConflictResponse);

const summaryColumns = "id, title, created_at, updated_at, last_opened_at";

const orderBy: Record<DocumentSort, string> = {
  lastOpened: "last_opened_at DESC",
  lastModified: "updated_at DESC",
  title: "title COLLATE NOCASE ASC",
};

export function createDocument(db: Database, title = UNTITLED, now = Date.now()): DocumentSummary {
  const id = randomUUID();
  const doc = Node.fromJSON(documentSchema, emptyDocument);
  db.prepare(
    `INSERT INTO documents (id, title, content, plain_text, version, created_at, updated_at, last_opened_at)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
  ).run(id, normalizeTitle(title), JSON.stringify(doc.toJSON()), "", now, now, now);
  return { id, title: normalizeTitle(title), createdAt: now, updatedAt: now, lastOpenedAt: now };
}

export function listDocuments(db: Database, options: { query?: string; sort?: DocumentSort } = {}): DocumentSummary[] {
  const sort = options.sort ?? "lastOpened";
  const query = options.query?.trim();
  const rows = query
    ? db
        .prepare(
          `SELECT ${summaryColumns} FROM documents
           WHERE title LIKE ? ESCAPE '\\' OR plain_text LIKE ? ESCAPE '\\'
           ORDER BY ${orderBy[sort]}`,
        )
        .all(likePattern(query), likePattern(query))
    : db.prepare(`SELECT ${summaryColumns} FROM documents ORDER BY ${orderBy[sort]}`).all();
  return (rows as DocumentRow[]).map(toSummary);
}

/** Loads a document for editing and marks it as opened. */
export function openDocument(db: Database, id: string, now = Date.now()): OpenedDocument | null {
  const row = findRow(db, id);
  if (!row) return null;
  db.prepare("UPDATE documents SET last_opened_at = ? WHERE id = ?").run(now, id);
  return {
    ...toSummary({ ...row, last_opened_at: now }),
    version: row.version,
    content: JSON.parse(row.content),
    comments: listComments(db, id),
  };
}

export function renameDocument(db: Database, id: string, title: string, now = Date.now()): DocumentSummary | null {
  const result = db.prepare("UPDATE documents SET title = ?, updated_at = ? WHERE id = ?").run(normalizeTitle(title), now, id);
  if (result.changes === 0) return null;
  return toSummary(findRow(db, id)!);
}

export function deleteDocument(db: Database, id: string): boolean {
  return db.prepare("DELETE FROM documents WHERE id = ?").run(id).changes > 0;
}

export function getDocumentContent(db: Database, id: string): { title: string; version: number; doc: Node } | null {
  const row = findRow(db, id);
  return row ? { title: row.title, version: row.version, doc: Node.fromJSON(documentSchema, JSON.parse(row.content)) } : null;
}

/**
 * Applies a batch of steps that the client built on top of `version`.
 * A batch based on an older version is rejected with the steps the client is missing.
 */
export function applySteps(
  db: Database,
  id: string,
  request: { clientId: string; version: number; steps: unknown[] },
  now = Date.now(),
  restoredFrom: number | null = null,
): ApplyStepsResult | null {
  return inTransaction(db, () => {
    const row = findRow(db, id);
    if (!row) return null;

    if (request.version !== row.version) {
      if (request.version > row.version) throw new InvalidStepsError("Version is ahead of the server");
      return { kind: "conflict", ...stepsSince(db, id, request.version), version: row.version };
    }
    if (request.steps.length === 0) return { kind: "applied", version: row.version };

    let doc = Node.fromJSON(documentSchema, JSON.parse(row.content));
    const insertStep = db.prepare("INSERT INTO steps (document_id, version, step, client_id) VALUES (?, ?, ?, ?)");
    let version = row.version;
    const mapping = new Mapping();
    for (const json of request.steps) {
      const step = parseStep(json);
      doc = applyStep(step, doc);
      mapping.appendMap(step.getMap());
      version += 1;
      insertStep.run(id, version, JSON.stringify(step.toJSON()), request.clientId);
    }
    mapComments(db, id, mapping);

    const content = JSON.stringify(doc.toJSON());
    db.prepare("UPDATE documents SET content = ?, plain_text = ?, version = ?, updated_at = ? WHERE id = ?").run(
      content,
      plainText(doc),
      version,
      now,
      id,
    );
    recordRevision(db, id, version, content, now, restoredFrom);
    return { kind: "applied", version };
  });
}

/**
 * Replaces the document's content with a revision's, as a regular step so the step log stays complete.
 * Only the range that differs is replaced, so comments on unchanged text keep their anchors.
 */
export function restoreRevision(db: Database, id: string, revisionId: number, now = Date.now()): { version: number } | null {
  const current = findRow(db, id);
  const revision = getRevision(db, id, revisionId);
  if (!current || !revision) return null;

  const doc = Node.fromJSON(documentSchema, JSON.parse(current.content));
  const target = Node.fromJSON(documentSchema, revision.content);
  const transform = replaceDifference(doc, target);
  const result = applySteps(
    db,
    id,
    { clientId: "restore", version: current.version, steps: transform.steps.map((step) => step.toJSON()) },
    now,
    revisionId,
  );
  return result?.kind === "applied" ? { version: result.version } : null;
}

/** A transform that turns `doc` into `target` by replacing only the range where they differ. */
export function replaceDifference(doc: Node, target: Node): Transform {
  const transform = new Transform(doc);
  const start = doc.content.findDiffStart(target.content);
  if (start === null) return transform;
  let { a: endA, b: endB } = doc.content.findDiffEnd(target.content)!;
  // When the differing ranges overlap (for example a repeated character), move both ends past the start.
  const overlap = start - Math.min(endA, endB);
  if (overlap > 0) {
    endA += overlap;
    endB += overlap;
  }
  return transform.replace(start, endA, target.slice(start, endB));
}

function stepsSince(db: Database, id: string, version: number): { steps: unknown[]; clientIds: string[] } {
  const rows = db
    .prepare("SELECT step, client_id FROM steps WHERE document_id = ? AND version > ? ORDER BY version")
    .all(id, version) as { step: string; client_id: string }[];
  return { steps: rows.map((row) => JSON.parse(row.step)), clientIds: rows.map((row) => row.client_id) };
}

function parseStep(json: unknown): Step {
  try {
    return Step.fromJSON(documentSchema, json);
  } catch (error) {
    throw new InvalidStepsError(`Invalid step: ${(error as Error).message}`);
  }
}

/** Steps report most failures in their result but throw for positions outside the document. */
function applyStep(step: Step, doc: Node): Node {
  let result;
  try {
    result = step.apply(doc);
  } catch (error) {
    throw new InvalidStepsError(`Step could not be applied: ${(error as Error).message}`);
  }
  if (!result.doc) throw new InvalidStepsError(result.failed ?? "Step could not be applied");
  return result.doc;
}

function plainText(doc: Node): string {
  return doc.textBetween(0, doc.content.size, "\n", " ");
}

function findRow(db: Database, id: string): DocumentRow | undefined {
  return db.prepare("SELECT * FROM documents WHERE id = ?").get(id) as DocumentRow | undefined;
}

function toSummary(row: Pick<DocumentRow, "id" | "title" | "created_at" | "updated_at" | "last_opened_at">): DocumentSummary {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastOpenedAt: row.last_opened_at,
  };
}

function normalizeTitle(title: string): string {
  return title.trim() || UNTITLED;
}

function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}
