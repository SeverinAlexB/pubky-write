import { documentSchema, pageSetupOf } from "@docs/shared";
import { Node } from "@tiptap/pm/model";
import { Transform } from "@tiptap/pm/transform";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "./database.ts";
import {
  applySteps,
  blankDocument,
  copyDocument,
  copyRevision,
  createDocument,
  deleteDocument,
  getDocumentContent,
  getDocumentPreview,
  getStepsSince,
  InvalidStepsError,
  listDocuments,
  nameCurrentVersion,
  openDocument,
  renameDocument,
  restoreRevision,
  templateDocument,
} from "./documents.ts";
import { listRevisions, nameRevision, SESSION_GAP_MS } from "./revisions.ts";

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

  it("recognises a batch sent again after it was applied, and does not apply it twice", () => {
    const { id } = createDocument(db);
    const steps = insertTextSteps(id, "Hello");
    applySteps(db, id, { clientId: "a", version: 0, steps });

    // The client never got the answer (the connection dropped, or the tab crashed) and sends it again.
    expect(applySteps(db, id, { clientId: "a", version: 0, steps })).toEqual({ kind: "applied", version: 1, alreadyApplied: true });
    expect(textOf(id)).toBe("Hello");
    expect(openDocument(db, id)!.version).toBe(1);

    // Also when other clients' steps followed it.
    applySteps(db, id, { clientId: "b", version: 1, steps: insertTextSteps(id, " world") });
    expect(applySteps(db, id, { clientId: "a", version: 0, steps })).toEqual({ kind: "applied", version: 1, alreadyApplied: true });
    expect(textOf(id)).toBe("Hello world");
  });

  it("treats the same steps from another client, or different steps, as a conflict", () => {
    const { id } = createDocument(db);
    const steps = insertTextSteps(id, "Hello");
    applySteps(db, id, { clientId: "a", version: 0, steps });

    expect(applySteps(db, id, { clientId: "b", version: 0, steps })).toMatchObject({ kind: "conflict", version: 1 });
    const other = new Transform(getDocumentContent(db, id)!.doc).insert(1, documentSchema.text("x")).steps.map((step) => step.toJSON());
    expect(applySteps(db, id, { clientId: "a", version: 0, steps: other })).toMatchObject({ kind: "conflict", version: 1 });
    // A longer batch whose start was applied is not "already applied" either.
    expect(applySteps(db, id, { clientId: "a", version: 0, steps: [...steps, ...steps] })).toMatchObject({ kind: "conflict" });
    expect(textOf(id)).toBe("Hello");
  });

  it("lists the steps after a version with their clients", () => {
    const { id } = createDocument(db);
    const first = insertTextSteps(id, "Hello");
    applySteps(db, id, { clientId: "a", version: 0, steps: first });
    const second = insertTextSteps(id, "!");
    applySteps(db, id, { clientId: "b", version: 1, steps: second });

    expect(getStepsSince(db, id, 0)).toEqual({ version: 2, steps: [...first, ...second], clientIds: ["a", "b"] });
    expect(getStepsSince(db, id, 2)).toEqual({ version: 2, steps: [], clientIds: [] });
    expect(() => getStepsSince(db, id, 3)).toThrow(InvalidStepsError);
    expect(getStepsSince(db, "missing", 0)).toBeNull();
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
    expect(listDocuments(db, { sort: "lastModifiedByMe" }).map((doc) => doc.title)).toEqual(["apple", "Banana"]);
    expect(listDocuments(db, { sort: "title" }).map((doc) => doc.title)).toEqual(["apple", "Banana"]);
  });

  it("renames, falling back to the default title when blank, and deletes", () => {
    const { id } = createDocument(db);
    expect(renameDocument(db, id, "  Report  ")!.title).toBe("Report");
    expect(renameDocument(db, id, "   ")!.title).toBe("Untitled document");
    expect(deleteDocument(db, id)).toBe(true);
    expect(openDocument(db, id)).toBeNull();
  });

  it("creates documents on the requested paper size", () => {
    const letter = createDocument(db, undefined, 0, blankDocument("Letter"));
    expect(pageSetupOf(getDocumentContent(db, letter.id)!.doc).paperSize).toBe("Letter");
    const fallback = createDocument(db, undefined, 0, blankDocument("Napkin"));
    expect(pageSetupOf(getDocumentContent(db, fallback.id)!.doc).paperSize).toBe("A4");
  });

  it("creates documents with the default page setup, ignoring invalid values", () => {
    const defaults = { paperSize: "A5", orientation: "landscape", marginLeft: 36, marginTop: "lots", pageColor: "#fce5cd", other: 1 };
    const doc = blankDocument("Letter", defaults);
    expect(pageSetupOf(doc)).toEqual({
      paperSize: "A5",
      orientation: "landscape",
      marginTop: 72,
      marginBottom: 72,
      marginLeft: 36,
      marginRight: 72,
      pageColor: "#fce5cd",
    });
    expect(() => doc.check()).not.toThrow();
    // The paper size of the locale when the defaults have none.
    expect(pageSetupOf(blankDocument("Letter", { marginLeft: 18 }))).toMatchObject({ paperSize: "Letter", marginLeft: 18 });
    expect(pageSetupOf(templateDocument("letter", "A4", { pageColor: "#d9ead3" })!.doc).pageColor).toBe("#d9ead3");
  });

  it("rejects steps that set invalid page settings", () => {
    const { id } = createDocument(db);
    const step = { stepType: "docAttr", attr: "marginTop", value: "lots" };
    expect(() => applySteps(db, id, { clientId: "a", version: 0, steps: [step] })).toThrow(InvalidStepsError);
  });

  it("stores headers and footnote text set with attribute steps, and rejects invalid ones", () => {
    const { id } = createDocument(db);
    const header = [{ type: "paragraph", content: [{ type: "pageField", attrs: { kind: "page" } }] }];
    const note = { type: "footnote", attrs: { content: [{ type: "paragraph", content: [{ type: "text", text: "Note" }] }] } };
    const steps = [
      { stepType: "docAttr", attr: "header", value: header },
      { stepType: "replace", from: 1, to: 1, slice: { content: [note] } },
      { stepType: "attr", pos: 1, attr: "content", value: [{ type: "paragraph", content: [{ type: "text", text: "Edited" }] }] },
    ];
    expect(applySteps(db, id, { clientId: "a", version: 0, steps })).toEqual({ kind: "applied", version: 3 });
    const { doc } = getDocumentContent(db, id)!;
    expect(doc.attrs.header).toEqual(header);
    expect(doc.firstChild!.firstChild!.attrs.content[0].content[0].text).toBe("Edited");

    for (const step of [
      { stepType: "docAttr", attr: "footer", value: [{ type: "pageBreak" }] },
      { stepType: "attr", pos: 1, attr: "content", value: [{ type: "image", attrs: { src: "/x.png" } }] },
    ]) {
      expect(() => applySteps(db, id, { clientId: "a", version: 3, steps: [step] })).toThrow(InvalidStepsError);
    }
  });

  it("copies a document's content under a new title", () => {
    const original = createDocument(db, "Plan", 1);
    applySteps(db, original.id, { clientId: "a", version: 0, steps: insertTextSteps(original.id, "Budget") });
    const copy = copyDocument(db, original.id, 5)!;

    expect(copy.title).toBe("Copy of Plan");
    expect(textOf(copy.id)).toBe("Budget");
    expect(listDocuments(db, { query: "budget" })).toHaveLength(2);
    expect(copyDocument(db, "missing")).toBeNull();
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

  it("restores page settings with the content", () => {
    const { id } = createDocument(db, "Doc", 0);
    applySteps(db, id, { clientId: "a", version: 0, steps: insertTextSteps(id, "text") }, 1_000);
    const before = listRevisions(db, id)[0]!;
    const { doc } = getDocumentContent(db, id)!;
    const landscape = new Transform(doc).setDocAttribute("orientation", "landscape").setDocAttribute("marginLeft", 36);
    const steps = landscape.steps.map((step) => step.toJSON());
    applySteps(db, id, { clientId: "a", version: 1, steps }, 1_000 + SESSION_GAP_MS);
    expect(pageSetupOf(getDocumentContent(db, id)!.doc)).toMatchObject({ orientation: "landscape", marginLeft: 36 });

    restoreRevision(db, id, before.id, 2_000 + SESSION_GAP_MS);

    expect(pageSetupOf(getDocumentContent(db, id)!.doc)).toMatchObject({ orientation: "portrait", marginLeft: 72 });
    expect(textOf(id)).toBe("text");
  });

  it("names versions, and a named version stops absorbing edits", () => {
    const { id } = createDocument(db, "Doc", 0);
    applySteps(db, id, { clientId: "a", version: 0, steps: insertTextSteps(id, "one") }, 1_000);

    expect(nameCurrentVersion(db, id, "  Draft  ", 1_500)).toMatchObject({ version: 1, name: "Draft" });
    applySteps(db, id, { clientId: "a", version: 1, steps: insertTextSteps(id, " two") }, 2_000);

    const [latest, named] = listRevisions(db, id);
    expect(named).toMatchObject({ version: 1, name: "Draft" });
    expect(latest).toMatchObject({ version: 2, name: null });
    expect(nameRevision(db, id, named!.id, " ")).toMatchObject({ name: null });
    expect(nameRevision(db, id, 9_999, "Missing")).toBeNull();
  });

  it("records a version when naming a document without edits", () => {
    const { id } = createDocument(db, "Doc", 0);
    expect(nameCurrentVersion(db, id, "Empty", 1_000)).toMatchObject({ version: 0, name: "Empty" });
    expect(listRevisions(db, id)).toHaveLength(1);
  });

  it("copies a version into a new document", () => {
    const { id } = createDocument(db, "Plan", 0);
    applySteps(db, id, { clientId: "a", version: 0, steps: insertTextSteps(id, "first draft") }, 1_000);
    applySteps(db, id, { clientId: "a", version: 1, steps: insertTextSteps(id, " plus edits") }, 1_000 + SESSION_GAP_MS);
    const firstDraft = listRevisions(db, id).at(-1)!;

    const copy = copyRevision(db, id, firstDraft.id)!;

    expect(copy.title).toBe("Copy of Plan");
    expect(textOf(copy.id)).toBe("first draft");
    expect(textOf(id)).toBe("first draft plus edits");
    expect(copyRevision(db, id, 9_999)).toBeNull();
  });

  it("keeps the stored document valid against the schema", () => {
    const { id } = createDocument(db);
    applySteps(db, id, { clientId: "a", version: 0, steps: insertTextSteps(id, "text") });
    const { content } = openDocument(db, id)!;
    expect(() => Node.fromJSON(documentSchema, content).check()).not.toThrow();
  });
});

describe("previews", () => {
  it("hold the top of the first page and follow edits", () => {
    const { id } = createDocument(db);
    applySteps(db, id, { clientId: "a", version: 0, steps: insertTextSteps(id, "Hello") });
    expect(getDocumentPreview(db, id)).toEqual({ content: getDocumentContent(db, id)!.doc.toJSON() });
    expect(getDocumentPreview(db, "missing")).toBeNull();
  });

  it("stop at the first page break and cut long documents to about a page", () => {
    const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
    const long = Node.fromJSON(documentSchema, {
      type: "doc",
      content: [
        ...Array.from({ length: 200 }, (_, index) => paragraph(`Paragraph ${index}`)),
        { type: "pageBreak" },
        paragraph("Second page"),
      ],
    });
    const { id } = createDocument(db, "Long", 1, long);
    const preview = getDocumentPreview(db, id)!.content;
    expect(preview.content!.length).toBeGreaterThan(40);
    expect(preview.content!.length).toBeLessThan(80);

    const broken = Node.fromJSON(documentSchema, {
      type: "doc",
      content: [paragraph("First page"), { type: "pageBreak" }, paragraph("Second page")],
    });
    const short = createDocument(db, "Short", 1, broken);
    expect(getDocumentPreview(db, short.id)!.content.content?.map((block) => block.content?.[0]?.text)).toEqual(["First page"]);
  });

  it("are made for documents stored before previews existed", () => {
    const { id } = createDocument(db);
    db.prepare("UPDATE documents SET preview = NULL WHERE id = ?").run(id);
    expect(getDocumentPreview(db, id)!.content.type).toBe("doc");
    expect(db.prepare("SELECT preview FROM documents WHERE id = ?").get(id)).not.toEqual({ preview: null });
  });
});

describe("templateDocument", () => {
  it("builds valid documents from every template on the requested paper size", () => {
    for (const id of ["letter", "resume", "project-proposal", "report"]) {
      const template = templateDocument(id, "Letter")!;
      template.doc.check();
      expect(template.doc.attrs.paperSize).toBe("Letter");
      expect(template.doc.textContent.length).toBeGreaterThan(100);
    }
    expect(templateDocument("Resume")?.name).toBeUndefined();
    expect(templateDocument("resume")?.name).toBe("Resume");
  });
});
