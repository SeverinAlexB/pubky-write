import { documentSchema } from "@docs/shared";
import { Transform } from "@tiptap/pm/transform";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addReply,
  CommentVersionConflictError,
  createComment,
  deleteComment,
  deleteReply,
  editMessage,
  InvalidCommentError,
  listComments,
  setResolved,
} from "./comments.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./app.ts";
import { openDatabase, type Database } from "./database.ts";
import { applySteps, createDocument, getDocumentContent, restoreRevision } from "./documents.ts";
import { listRevisions, SESSION_GAP_MS } from "./revisions.ts";

let db: Database;
let documentId: string;

beforeEach(() => {
  db = openDatabase(":memory:");
  documentId = createDocument(db, "Doc", 0).id;
  edit((tr) => tr.insert(1, documentSchema.text("The quick brown fox")), 1_000);
});

/** Applies an edit to the stored document through the normal step path. */
function edit(build: (tr: Transform) => Transform, now = 2_000): void {
  const { doc, version } = getDocumentContent(db, documentId)!;
  const steps = build(new Transform(doc)).steps.map((step) => step.toJSON());
  applySteps(db, documentId, { clientId: "test", version, steps }, now);
}

function comment(from: number, to: number, body = "Note") {
  return createComment(db, documentId, getDocumentContent(db, documentId)!, {
    version: getDocumentContent(db, documentId)!.version,
    from,
    to,
    body,
  });
}

/** "quick" is at positions 5..10 ("The " starts at 1). */
const QUICK = { from: 5, to: 10 };

describe("creating comments", () => {
  it("stores the anchor, the quoted text and the first message", () => {
    const thread = comment(QUICK.from, QUICK.to, "  Too vague?  ");
    expect(thread).toMatchObject({ from: 5, to: 10, quote: "quick", resolved: false });
    expect(thread.messages.map((message) => message.body)).toEqual(["Too vague?"]);
  });

  it("rejects anchors built on an old version", () => {
    const { doc } = getDocumentContent(db, documentId)!;
    expect(() => createComment(db, documentId, { version: 99, doc }, { version: 1, ...QUICK, body: "x" })).toThrow(
      CommentVersionConflictError,
    );
  });

  it("rejects empty ranges, ranges outside the document and empty bodies", () => {
    expect(() => comment(5, 5)).toThrow(InvalidCommentError);
    expect(() => comment(5, 500)).toThrow(InvalidCommentError);
    expect(() => comment(5, 10, "   ")).toThrow(InvalidCommentError);
  });
});

describe("anchors follow edits", () => {
  it("shifts when text is inserted before the anchor", () => {
    comment(QUICK.from, QUICK.to);
    edit((tr) => tr.insert(1, documentSchema.text("Look: ")));
    expect(listComments(db, documentId)[0]).toMatchObject({ from: 11, to: 16 });
  });

  it("keeps text typed at either edge outside the anchor", () => {
    comment(QUICK.from, QUICK.to);
    edit((tr) => tr.insert(10, documentSchema.text("est")));
    edit((tr) => tr.insert(5, documentSchema.text("very ")));
    const [thread] = listComments(db, documentId);
    expect(getDocumentContent(db, documentId)!.doc.textBetween(thread!.from, thread!.to)).toBe("quick");
  });

  it("grows when text is inserted inside the anchor", () => {
    comment(QUICK.from, QUICK.to);
    edit((tr) => tr.insert(7, documentSchema.text("-")));
    expect(listComments(db, documentId)[0]).toMatchObject({ from: 5, to: 11 });
  });

  it("collapses when the anchored text is deleted, keeping the quote", () => {
    comment(QUICK.from, QUICK.to);
    edit((tr) => tr.delete(4, 11));
    expect(listComments(db, documentId)[0]).toMatchObject({ from: 4, to: 4, quote: "quick" });
  });

  it("keeps moving after its text was deleted, as the editor moves it", () => {
    comment(QUICK.from, QUICK.to);
    edit((tr) => tr.delete(4, 11));
    edit((tr) => tr.insert(1, documentSchema.text("Oh, ")));
    expect(listComments(db, documentId)[0]).toMatchObject({ from: 8, to: 8 });
  });
});

describe("threads", () => {
  it("adds replies, resolves, reopens and deletes", () => {
    const { id } = comment(QUICK.from, QUICK.to, "First");
    expect(addReply(db, documentId, id, "Second")!.messages.map((message) => message.body)).toEqual(["First", "Second"]);
    expect(setResolved(db, documentId, id, true)!.resolved).toBe(true);
    expect(setResolved(db, documentId, id, false)!.resolved).toBe(false);
    expect(deleteComment(db, documentId, id)).toBe(true);
    expect(listComments(db, documentId)).toEqual([]);
  });

  it("does not touch comments of other documents", () => {
    const { id } = comment(QUICK.from, QUICK.to);
    const other = createDocument(db).id;
    expect(addReply(db, other, id, "Hi")).toBeNull();
    expect(deleteComment(db, other, id)).toBe(false);
  });
});

describe("editing and deleting messages", () => {
  it("edits the first message and replies, trimming the text", () => {
    const { id, messages } = comment(QUICK.from, QUICK.to, "First");
    const withReply = addReply(db, documentId, id, "Second")!;
    expect(editMessage(db, documentId, id, messages[0]!.id, " First, edited ")!.messages.map((m) => m.body)).toEqual([
      "First, edited",
      "Second",
    ]);
    expect(editMessage(db, documentId, id, withReply.messages[1]!.id, "Second, edited")!.messages[1]!.body).toBe(
      "Second, edited",
    );
  });

  it("rejects empty text", () => {
    const { id, messages } = comment(QUICK.from, QUICK.to, "First");
    expect(() => editMessage(db, documentId, id, messages[0]!.id, "  ")).toThrow(InvalidCommentError);
  });

  it("deletes replies but not the first message", () => {
    const { id, messages } = comment(QUICK.from, QUICK.to, "First");
    const reply = addReply(db, documentId, id, "Second")!.messages[1]!;
    expect(deleteReply(db, documentId, id, reply.id)!.messages.map((m) => m.body)).toEqual(["First"]);
    expect(() => deleteReply(db, documentId, id, messages[0]!.id)).toThrow(InvalidCommentError);
  });

  it("only finds messages through their own thread and document", () => {
    const first = comment(QUICK.from, QUICK.to, "First");
    const second = comment(11, 16, "Other");
    const other = createDocument(db).id;
    const messageId = first.messages[0]!.id;
    expect(editMessage(db, other, first.id, messageId, "x")).toBeNull();
    expect(editMessage(db, documentId, second.id, messageId, "x")).toBeNull();
    expect(deleteReply(db, other, first.id, messageId)).toBeNull();
    expect(listComments(db, documentId)[0]!.messages[0]!.body).toBe("First");
  });
});

describe("message endpoints", () => {
  const app = () => createApp({ db, uploadsDir: mkdtempSync(join(tmpdir(), "docs-uploads-")) });
  const send = (method: string, path: string, body?: unknown) =>
    app().request(path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  it("PATCH edits a message and returns the thread", async () => {
    const { id, messages } = comment(QUICK.from, QUICK.to, "First");
    const response = await send("PATCH", `/api/documents/${documentId}/comments/${id}/messages/${messages[0]!.id}`, {
      body: "Edited",
    });
    expect(response.status).toBe(200);
    expect((await response.json()).messages[0].body).toBe("Edited");
    expect(listComments(db, documentId)[0]!.messages[0]!.body).toBe("Edited");
  });

  it("PATCH answers 400 for an empty body and 404 for another document", async () => {
    const { id, messages } = comment(QUICK.from, QUICK.to, "First");
    const path = (doc: string) => `/api/documents/${doc}/comments/${id}/messages/${messages[0]!.id}`;
    expect((await send("PATCH", path(documentId), { body: "" })).status).toBe(400);
    expect((await send("PATCH", path(createDocument(db).id), { body: "x" })).status).toBe(404);
  });

  it("DELETE removes a reply, refuses the first message and answers 404 for unknown messages", async () => {
    const { id, messages } = comment(QUICK.from, QUICK.to, "First");
    const reply = addReply(db, documentId, id, "Second")!.messages[1]!;
    const path = (messageId: number) => `/api/documents/${documentId}/comments/${id}/messages/${messageId}`;
    const response = await send("DELETE", path(reply.id));
    expect(response.status).toBe(200);
    expect((await response.json()).messages).toHaveLength(1);
    expect((await send("DELETE", path(messages[0]!.id))).status).toBe(400);
    expect((await send("DELETE", path(reply.id))).status).toBe(404);
  });
});

describe("restoring a version", () => {
  it("only replaces what changed, so comments on unchanged text survive", () => {
    const [original] = listRevisions(db, documentId); // the session from beforeEach
    edit((tr) => tr.insert(20, documentSchema.text(" jumps")), 1_000 + SESSION_GAP_MS);
    comment(QUICK.from, QUICK.to);

    restoreRevision(db, documentId, original!.id, 2_000 + SESSION_GAP_MS);

    const { doc } = getDocumentContent(db, documentId)!;
    expect(doc.textContent).toBe("The quick brown fox");
    const [thread] = listComments(db, documentId);
    expect(doc.textBetween(thread!.from, thread!.to)).toBe("quick");
  });
});
