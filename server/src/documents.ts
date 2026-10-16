// Document storage and the step authority. The server applies every batch of steps
// to its copy of the document, so it always holds the authoritative version.
import { randomUUID } from "node:crypto";
import {
  acceptedDocument,
  documentSchema,
  emptyDocument,
  findTemplate,
  isPaperSize,
  normalizePageSetup,
  pageSetupKeys,
  replaceDifference,
  type DocumentPreview,
  type DocumentSort,
  type DocumentSummary,
  type OpenedDocument,
  type Revision,
  type StepsConflictResponse,
} from "@pubky-write/shared";
import { Node } from "@tiptap/pm/model";
import { Mapping, Step, Transform } from "@tiptap/pm/transform";
import { listComments, listSuggestionReplies, mapComments } from "./comments.ts";
import { inTransaction, type Database } from "./database.ts";
import { documentPreview } from "./preview.ts";
import { getRevision, nameCurrentRevision, recordRevision } from "./revisions.ts";

export const UNTITLED = "Untitled document";

type DocumentRow = {
  id: string;
  title: string;
  content: string;
  version: number;
  created_at: number;
  updated_at: number;
  last_opened_at: number;
  preview: string | null;
};

export class InvalidStepsError extends Error {}

/** The batch comes from an editor session whose kept edits another session has restored. */
export class SessionEndedError extends InvalidStepsError {}

/** `alreadyApplied`: the batch had been applied before (a client resending it after losing the answer). */
export type ApplyStepsResult =
  | { kind: "applied"; version: number; alreadyApplied?: true }
  | ({ kind: "conflict" } & StepsConflictResponse);

const summaryColumns = "id, title, created_at, updated_at, last_opened_at";

const orderBy: Record<DocumentSort, string> = {
  lastOpened: "last_opened_at DESC",
  lastModifiedByMe: "updated_at DESC",
  lastModified: "updated_at DESC",
  title: "title COLLATE NOCASE ASC",
};

export function createDocument(
  db: Database,
  title = UNTITLED,
  now = Date.now(),
  doc = Node.fromJSON(documentSchema, emptyDocument),
): DocumentSummary {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO documents (id, title, content, plain_text, preview, version, created_at, updated_at, last_opened_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
  ).run(id, normalizeTitle(title), JSON.stringify(doc.toJSON()), plainText(doc), previewJson(doc), now, now, now);
  return { id, title: normalizeTitle(title), createdAt: now, updatedAt: now, lastOpenedAt: now };
}

/**
 * The content of a new blank document on the given paper size (the client picks it from the
 * user's locale), with the page setup saved by "Set as default" in Page setup, if any.
 */
export function blankDocument(paperSize?: unknown, pageSetup?: unknown): Node {
  return withPageSetup(Node.fromJSON(documentSchema, emptyDocument), paperSize, pageSetup);
}

/** A new document from a built-in template, on the given paper size and default page setup. Null for an unknown template. */
export function templateDocument(templateId: string, paperSize?: unknown, pageSetup?: unknown): { name: string; doc: Node } | null {
  const template = findTemplate(templateId);
  if (!template) return null;
  return { name: template.name, doc: withPageSetup(Node.fromJSON(documentSchema, template.content), paperSize, pageSetup) };
}

/** Invalid values in `pageSetup` are ignored. */
function withPageSetup(doc: Node, paperSize: unknown, pageSetup: unknown): Node {
  const transform = new Transform(doc);
  if (isPaperSize(paperSize)) transform.setDocAttribute("paperSize", paperSize);
  if (pageSetup && typeof pageSetup === "object") {
    const current = normalizePageSetup(transform.doc.attrs);
    const setup = normalizePageSetup({ ...current, ...Object.fromEntries(Object.entries(pageSetup).filter(([key]) => key in current)) });
    // A value normalizePageSetup rejected falls back to its default, not to the current value.
    for (const key of pageSetupKeys) {
      const value = (pageSetup as Record<string, unknown>)[key] === setup[key] ? setup[key] : current[key];
      if (transform.doc.attrs[key] !== value) transform.setDocAttribute(key, value);
    }
  }
  return transform.doc;
}

/** The thumbnail content of a document (see preview.ts); made and stored on first use for older documents. */
export function getDocumentPreview(db: Database, id: string): DocumentPreview | null {
  const row = db.prepare("SELECT content, preview FROM documents WHERE id = ?").get(id) as
    | Pick<DocumentRow, "content" | "preview">
    | undefined;
  if (!row) return null;
  if (row.preview !== null) return { content: JSON.parse(row.preview) };
  const preview = previewJson(Node.fromJSON(documentSchema, JSON.parse(row.content)));
  db.prepare("UPDATE documents SET preview = ? WHERE id = ?").run(preview, id);
  return { content: JSON.parse(preview) };
}

/** File > Make a copy: a new document named "Copy of <title>" with the same content, without comments. */
export function copyDocument(db: Database, id: string, now = Date.now()): DocumentSummary | null {
  const row = findRow(db, id);
  if (!row) return null;
  return createDocument(db, `Copy of ${row.title}`, now, Node.fromJSON(documentSchema, JSON.parse(row.content)));
}

/** Make a copy from version history: a new document with a version's content, without comments. */
export function copyRevision(db: Database, id: string, revisionId: number, now = Date.now()): DocumentSummary | null {
  const row = findRow(db, id);
  const revision = getRevision(db, id, revisionId);
  if (!row || !revision) return null;
  return createDocument(db, `Copy of ${row.title}`, now, Node.fromJSON(documentSchema, revision.content));
}

/** File > Version history > Name current version. */
export function nameCurrentVersion(db: Database, id: string, name: string, now = Date.now()): Revision | null {
  return inTransaction(db, () => {
    const row = findRow(db, id);
    return row ? nameCurrentRevision(db, id, { version: row.version, content: row.content }, name, now) : null;
  });
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
    suggestionReplies: listSuggestionReplies(db, id),
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
    if (db.prepare("SELECT 1 FROM ended_sessions WHERE document_id = ? AND client_id = ?").get(id, request.clientId)) {
      throw new SessionEndedError("This editing session has ended: its edits were restored in another one");
    }

    if (request.version !== row.version) {
      if (request.version > row.version) throw new InvalidStepsError("Version is ahead of the server");
      if (isAlreadyApplied(db, id, request)) {
        return { kind: "applied", version: request.version + request.steps.length, alreadyApplied: true };
      }
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
    db.prepare("UPDATE documents SET content = ?, plain_text = ?, preview = ?, version = ?, updated_at = ? WHERE id = ?").run(
      content,
      plainText(doc),
      previewJson(doc),
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

/**
 * Whether the same client already submitted exactly these steps on top of `version`: they are the
 * steps right after it. A batch is applied whole or not at all, so its steps are either all there
 * or none of them.
 */
function isAlreadyApplied(db: Database, id: string, request: { clientId: string; version: number; steps: unknown[] }): boolean {
  if (request.steps.length === 0) return false;
  const rows = db
    .prepare("SELECT step, client_id FROM steps WHERE document_id = ? AND version > ? ORDER BY version LIMIT ?")
    .all(id, request.version, request.steps.length) as { step: string; client_id: string }[];
  if (rows.length !== request.steps.length) return false;
  return rows.every((row, index) => {
    if (row.client_id !== request.clientId) return false;
    try {
      return JSON.stringify(Step.fromJSON(documentSchema, request.steps[index]).toJSON()) === row.step;
    } catch {
      return false;
    }
  });
}

/** The steps after `version` and the clients that sent them, with the current version; null for an unknown document. */
export function getStepsSince(db: Database, id: string, version: number): StepsConflictResponse | null {
  const row = findRow(db, id);
  if (!row) return null;
  if (version > row.version || version < 0) throw new InvalidStepsError("Version is not known to the server");
  return { version: row.version, ...stepsSince(db, id, version) };
}

/**
 * Ends an editor session before its kept edits are restored by another one, and returns the steps
 * after `version` (see getStepsSince). From then on the server refuses the session's batches, so a
 * batch it sent just before it closed cannot be applied after the restoring session has looked at
 * the steps: it is either among them or never applied. Null for an unknown document.
 */
export function endSession(db: Database, id: string, clientId: string, version: number): StepsConflictResponse | null {
  return inTransaction(db, () => {
    const result = getStepsSince(db, id, version);
    if (result) db.prepare("INSERT OR IGNORE INTO ended_sessions (document_id, client_id) VALUES (?, ?)").run(id, clientId);
    return result;
  });
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

/** The text searched in the document list: the document as if its suggestions were accepted (equations as their LaTeX). */
function plainText(source: Node): string {
  const doc = acceptedDocument(source);
  return doc.textBetween(0, doc.content.size, "\n", (leaf) => (leaf.type.name === "equation" ? ` ${String(leaf.attrs.latex)} ` : " "));
}

function previewJson(doc: Node): string {
  return JSON.stringify(documentPreview(doc));
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
