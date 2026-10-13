import { documentSchema } from "@docs/shared";
import { Node } from "@tiptap/pm/model";
import { Transform } from "@tiptap/pm/transform";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addReply,
  CommentVersionConflictError,
  createComment,
  deleteComment,
  InvalidCommentError,
  listComments,
  setResolved,
} from "./comments.ts";
import { openDatabase, type Database } from "./database.ts";
import { applySteps, createDocument, getDocumentContent, replaceDifference, restoreRevision } from "./documents.ts";
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

describe("replaceDifference", () => {
  const paragraphs = (...texts: string[]) =>
    Node.fromJSON(documentSchema, {
      type: "doc",
      content: texts.map((text) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] })),
    });

  it.each([
    [["aaa"], ["aa"]],
    [["abc", "def"], ["abc"]],
    [["abc"], ["abc", "", "xyz"]],
    [["one", "two"], ["one", "TWO", "three"]],
    [["same"], ["same"]],
  ])("turns %j into %j", (from, to) => {
    const target = paragraphs(...to);
    expect(replaceDifference(paragraphs(...from), target).doc.eq(target)).toBe(true);
  });
});
