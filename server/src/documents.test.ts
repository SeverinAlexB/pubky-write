import { documentSchema } from "@docs/shared";
import { Node } from "@tiptap/pm/model";
import { Transform } from "@tiptap/pm/transform";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "./database.ts";
import {
  applySteps,
  createDocument,
  deleteDocument,
  getDocumentContent,
  InvalidStepsError,
  listDocuments,
  openDocument,
  renameDocument,
  restoreRevision,
} from "./documents.ts";
import { listRevisions, SESSION_GAP_MS } from "./revisions.ts";

let db: Database;

beforeEach(() => {
  db = openDatabase(":memory:");
});

/** Steps that insert `text` at the end of the document's last paragraph. */
function insertTextSteps(id: string, text: string): unknown[] {
  const { doc } = getDocumentContent(db, id)!;
  const end = doc.content.size - 1;
  return new Transform(doc).insert(end, documentSchema.text(text)).steps.map((step) => step.toJSON());
}

function textOf(id: string): string {
  return getDocumentContent(db, id)!.doc.textContent;
}

describe("applySteps", () => {
  it("applies steps and advances the version", () => {
    const { id } = createDocument(db);

    const result = applySteps(db, id, { clientId: "a", version: 0, steps: insertTextSteps(id, "Hello") });

    expect(result).toEqual({ kind: "applied", version: 1 });
    expect(textOf(id)).toBe("Hello");
    expect(openDocument(db, id)!.version).toBe(1);
  });

  it("rejects a batch built on an old version and returns the missing steps", () => {
    const { id } = createDocument(db);
    const firstSteps = insertTextSteps(id, "Hello");
    applySteps(db, id, { clientId: "a", version: 0, steps: firstSteps });

    const result = applySteps(db, id, { clientId: "b", version: 0, steps: firstSteps });

    expect(result).toEqual({ kind: "conflict", version: 1, steps: firstSteps, clientIds: ["a"] });
    expect(textOf(id)).toBe("Hello");
  });

  it("rejects steps that do not fit the document", () => {
    const { id } = createDocument(db);
    const outOfRange = { stepType: "replace", from: 50, to: 50, slice: { content: [{ type: "text", text: "x" }] } };

    expect(() => applySteps(db, id, { clientId: "a", version: 0, steps: [outOfRange] })).toThrow(InvalidStepsError);
    expect(openDocument(db, id)!.version).toBe(0);
  });

  it("rejects malformed steps", () => {
    const { id } = createDocument(db);
    expect(() => applySteps(db, id, { clientId: "a", version: 0, steps: [{ stepType: "nonsense" }] })).toThrow(
      InvalidStepsError,
    );
  });

  it("returns null for an unknown document", () => {
    expect(applySteps(db, "missing", { clientId: "a", version: 0, steps: [] })).toBeNull();
  });
});

describe("document list", () => {
  it("searches titles and contents", () => {
    const notes = createDocument(db, "Meeting notes", 1);
    const plan = createDocument(db, "Plan", 2);
    applySteps(db, plan.id, { clientId: "a", version: 0, steps: insertTextSteps(plan.id, "Budget for Q3") });

    expect(listDocuments(db, { query: "meeting" }).map((doc) => doc.id)).toEqual([notes.id]);
    expect(listDocuments(db, { query: "budget" }).map((doc) => doc.id)).toEqual([plan.id]);
    expect(listDocuments(db, { query: "100%" })).toEqual([]);
  });

  it("sorts by last opened, last modified and title", () => {
    const b = createDocument(db, "Banana", 1);
    const a = createDocument(db, "apple", 2);
    openDocument(db, b.id, 10);
    applySteps(db, a.id, { clientId: "x", version: 0, steps: insertTextSteps(a.id, "edit") }, 20);

    expect(listDocuments(db, { sort: "lastOpened" }).map((doc) => doc.title)).toEqual(["Banana", "apple"]);
    expect(listDocuments(db, { sort: "lastModified" }).map((doc) => doc.title)).toEqual(["apple", "Banana"]);
    expect(listDocuments(db, { sort: "title" }).map((doc) => doc.title)).toEqual(["apple", "Banana"]);
  });

  it("renames, falling back to the default title when blank, and deletes", () => {
    const { id } = createDocument(db);
    expect(renameDocument(db, id, "  Report  ")!.title).toBe("Report");
    expect(renameDocument(db, id, "   ")!.title).toBe("Untitled document");
    expect(deleteDocument(db, id)).toBe(true);
    expect(openDocument(db, id)).toBeNull();
  });
});

describe("version history", () => {
  it("groups edits into sessions separated by idle time", () => {
    const { id } = createDocument(db, "Doc", 0);
    applySteps(db, id, { clientId: "a", version: 0, steps: insertTextSteps(id, "one") }, 1_000);
    applySteps(db, id, { clientId: "a", version: 1, steps: insertTextSteps(id, " two") }, 2_000);
    applySteps(db, id, { clientId: "a", version: 2, steps: insertTextSteps(id, " three") }, 2_000 + SESSION_GAP_MS);

    const revisions = listRevisions(db, id);
    expect(revisions.map((revision) => revision.version)).toEqual([3, 2]);
    expect(revisions[1]).toMatchObject({ startedAt: 1_000, endedAt: 2_000 });
  });

  it("restores a revision as a new version with its own history entry", () => {
    const { id } = createDocument(db, "Doc", 0);
    applySteps(db, id, { clientId: "a", version: 0, steps: insertTextSteps(id, "first draft") }, 1_000);
    applySteps(db, id, { clientId: "a", version: 1, steps: insertTextSteps(id, " plus edits") }, 1_000 + SESSION_GAP_MS);
    const firstDraft = listRevisions(db, id).at(-1)!;

    const restored = restoreRevision(db, id, firstDraft.id, 2_000 + SESSION_GAP_MS);

    expect(restored).toEqual({ version: 3 });
    expect(textOf(id)).toBe("first draft");
    const [latest] = listRevisions(db, id);
    expect(latest).toMatchObject({ version: 3, restoredFrom: firstDraft.id });

    // The next edit starts a new session instead of merging into the restore entry.
    applySteps(db, id, { clientId: "a", version: 3, steps: insertTextSteps(id, "!") }, 3_000 + SESSION_GAP_MS);
    expect(listRevisions(db, id)).toHaveLength(4);
  });

  it("keeps the stored document valid against the schema", () => {
    const { id } = createDocument(db);
    applySteps(db, id, { clientId: "a", version: 0, steps: insertTextSteps(id, "text") });
    const { content } = openDocument(db, id)!;
    expect(() => Node.fromJSON(documentSchema, content).check()).not.toThrow();
  });
});
