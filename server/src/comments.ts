// Comment threads. Anchors are kept in step with the document: applySteps calls mapComments
// with the same steps it applies, so stored positions always refer to the current version.
import { mapAnchor, type CommentMessage, type CommentThread, type CreateCommentRequest } from "@docs/shared";
import type { Node } from "@tiptap/pm/model";
import type { Mappable } from "@tiptap/pm/transform";
import type { Database } from "./database.ts";

export const MAX_COMMENT_LENGTH = 10_000;

export class InvalidCommentError extends Error {}

/** The comment was anchored using an outdated document version. */
export class CommentVersionConflictError extends Error {}

type CommentRow = {
  id: number;
  anchor_from: number;
  anchor_to: number;
  quote: string;
  resolved: number;
  created_at: number;
};

type MessageRow = { id: number; comment_id: number; body: string; created_at: number };

export function listComments(db: Database, documentId: string): CommentThread[] {
  const rows = db
    .prepare("SELECT * FROM comments WHERE document_id = ? ORDER BY anchor_from, id")
    .all(documentId) as CommentRow[];
  const messages = db
    .prepare(
      `SELECT m.* FROM comment_messages m JOIN comments c ON c.id = m.comment_id
       WHERE c.document_id = ? ORDER BY m.created_at, m.id`,
    )
    .all(documentId) as MessageRow[];
  return rows.map((row) => toThread(row, messages.filter((message) => message.comment_id === row.id)));
}

export function getComment(db: Database, documentId: string, commentId: number): CommentThread | null {
  const row = db.prepare("SELECT * FROM comments WHERE document_id = ? AND id = ?").get(documentId, commentId) as
    | CommentRow
    | undefined;
  if (!row) return null;
  const messages = db
    .prepare("SELECT * FROM comment_messages WHERE comment_id = ? ORDER BY created_at, id")
    .all(commentId) as MessageRow[];
  return toThread(row, messages);
}

/** Starts a thread on `from..to`, which must be a non-empty range in the document at `version`. */
export function createComment(
  db: Database,
  documentId: string,
  current: { version: number; doc: Node },
  request: CreateCommentRequest,
  now = Date.now(),
): CommentThread {
  if (request.version !== current.version) throw new CommentVersionConflictError("The document has changed");
  const { from, to } = request;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > current.doc.content.size || to <= from) {
    throw new InvalidCommentError("The comment must be anchored to a non-empty range in the document");
  }
  const quote = current.doc.textBetween(from, to, " ", " ").trim();
  if (!quote) throw new InvalidCommentError("Select some text to comment on");

  const body = validateBody(request.body);
  const { lastInsertRowid } = db
    .prepare("INSERT INTO comments (document_id, anchor_from, anchor_to, quote, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(documentId, from, to, quote, now);
  const commentId = Number(lastInsertRowid);
  insertMessage(db, commentId, body, now);
  return getComment(db, documentId, commentId)!;
}

export function addReply(db: Database, documentId: string, commentId: number, body: string, now = Date.now()) {
  if (!getComment(db, documentId, commentId)) return null;
  insertMessage(db, commentId, validateBody(body), now);
  return getComment(db, documentId, commentId);
}

export function setResolved(db: Database, documentId: string, commentId: number, resolved: boolean) {
  db.prepare("UPDATE comments SET resolved = ? WHERE document_id = ? AND id = ?").run(resolved ? 1 : 0, documentId, commentId);
  return getComment(db, documentId, commentId);
}

export function deleteComment(db: Database, documentId: string, commentId: number): boolean {
  return db.prepare("DELETE FROM comments WHERE document_id = ? AND id = ?").run(documentId, commentId).changes > 0;
}

/** Moves every live anchor through the steps just applied to the document. */
export function mapComments(db: Database, documentId: string, mapping: Mappable): void {
  const rows = db
    .prepare("SELECT id, anchor_from, anchor_to FROM comments WHERE document_id = ? AND anchor_to > anchor_from")
    .all(documentId) as Pick<CommentRow, "id" | "anchor_from" | "anchor_to">[];
  const update = db.prepare("UPDATE comments SET anchor_from = ?, anchor_to = ? WHERE id = ?");
  for (const row of rows) {
    const anchor = mapAnchor(mapping, { from: row.anchor_from, to: row.anchor_to });
    if (anchor.from !== row.anchor_from || anchor.to !== row.anchor_to) update.run(anchor.from, anchor.to, row.id);
  }
}

function insertMessage(db: Database, commentId: number, body: string, now: number): void {
  db.prepare("INSERT INTO comment_messages (comment_id, body, created_at) VALUES (?, ?, ?)").run(commentId, body, now);
}

function validateBody(body: unknown): string {
  if (typeof body !== "string" || !body.trim()) throw new InvalidCommentError("The comment is empty");
  if (body.length > MAX_COMMENT_LENGTH) throw new InvalidCommentError("The comment is too long");
  return body.trim();
}

function toThread(row: CommentRow, messages: MessageRow[]): CommentThread {
  return {
    id: row.id,
    from: row.anchor_from,
    to: row.anchor_to,
    quote: row.quote,
    resolved: row.resolved === 1,
    createdAt: row.created_at,
    messages: messages.map(
      (message): CommentMessage => ({ id: message.id, body: message.body, createdAt: message.created_at }),
    ),
  };
}
