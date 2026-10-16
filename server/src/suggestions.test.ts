import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectSuggestions,
  describeSuggestion,
  descriptionText,
  documentSchema,
  type CommentMessage,
  type DocumentSummary,
  type OpenedDocument,
} from "@pubky-write/shared";
import { Node } from "@tiptap/pm/model";
import { AddMarkStep } from "@tiptap/pm/transform";
import JSZip from "jszip";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { openDatabase, type Database } from "./database.ts";
import { applySteps, createDocument, listDocuments } from "./documents.ts";
import { toDocx } from "./export/docx.ts";
import { docxToDocument } from "./import/docx.ts";

const meta = (id: string, createdAt = Date.UTC(2026, 9, 14, 11, 53)) => ({ id, author: "You", createdAt });
const text = (value: string, marks: unknown[] = []) => ({ type: "text", text: value, ...(marks.length > 0 && { marks }) });

/** An insertion, a deletion, a bold format change and a suggested paragraph break. */
const suggested = () =>
  Node.fromJSON(documentSchema, {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          text("First item"),
          text(" suggested", [{ type: "suggestionInsert", attrs: meta("a") }]),
          text(" and "),
          text("Second item", [{ type: "suggestionDelete", attrs: meta("b") }]),
          text(" "),
          text("here", [{ type: "bold" }, { type: "suggestionFormat", attrs: { ...meta("c"), before: [] } }]),
        ],
      },
      {
        type: "paragraph",
        attrs: { suggestionBreak: { kind: "insert", ...meta("d") } },
        content: [text("New line", [{ type: "suggestionInsert", attrs: meta("d") }])],
      },
    ],
  });

const descriptions = (doc: Node) =>
  collectSuggestions(doc).map((suggestion) => describeSuggestion(suggestion).map(descriptionText).join(" / "));

describe("Word export and import of suggestions", () => {
  it("writes insertions, deletions, format changes and paragraph marks as tracked changes", async () => {
    const zip = await JSZip.loadAsync(await toDocx(suggested(), "Doc", async () => null));
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toMatch(/<w:ins w:id="\d+" w:author="You" w:date="2026-10-14T11:53:00.000Z"><w:r>.*?<w:t xml:space="preserve"> suggested<\/w:t>/);
    expect(xml).toMatch(/<w:del w:id="\d+" w:author="You" w:date="[^"]+"><w:r>.*?<w:delText xml:space="preserve">Second item<\/w:delText>/);
    expect(xml).toMatch(/<w:rPrChange w:id="\d+" w:author="You" w:date="[^"]+"><w:rPr><w:b w:val="false"\/>/);
    // The break before "New line" is the inserted paragraph mark of the first paragraph.
    expect(xml).toMatch(/<w:pPr><w:rPr><w:ins w:id="\d+" w:author="You" w:date="[^"]+"\/><\/w:rPr><\/w:pPr>/);
  });

  it("reads the tracked changes back as the same suggestions", async () => {
    const data = await toDocx(suggested(), "Doc", async () => null);
    const { doc } = await docxToDocument(new Uint8Array(data), { storeImage: async () => null });
    const imported = Node.fromJSON(documentSchema, doc.toJSON());
    expect(imported.textBetween(0, imported.content.size, "|")).toBe("First item suggested and Second item here|New line");
    expect(descriptions(imported)).toEqual(["Add: “suggested”", "Delete: “Second item”", "Format: bold", "Add: “New line”"]);
    const [insert] = collectSuggestions(imported);
    expect(insert).toMatchObject({ author: "You", createdAt: Date.UTC(2026, 9, 14, 11, 53) });
  });
});

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
const cell = (value: string, attrs: Record<string, unknown> = {}) => ({
  type: "tableCell",
  attrs,
  content: [{ type: "paragraph", content: [text(value)] }],
});

/** An inserted image, a deleted and an inserted table row, an inserted page break, a deleted footnote and a suggestion in the header. */
const structural = () =>
  Node.fromJSON(documentSchema, {
    type: "doc",
    attrs: { header: [{ type: "paragraph", content: [text("Draft", [{ type: "suggestionInsert", attrs: meta("h") }])] }] },
    content: [
      { type: "paragraph", content: [text("Intro")] },
      { type: "image", attrs: { src: "/uploads/a.png", width: 20, height: 20, suggestionInsert: meta("i") } },
      {
        type: "table",
        content: [
          { type: "tableRow", attrs: { suggestionDelete: meta("r") }, content: [cell("Old"), cell("Row")] },
          { type: "tableRow", content: [cell("Kept"), cell("Cells")] },
          { type: "tableRow", attrs: { suggestionInsert: meta("n") }, content: [cell("New"), cell("Row")] },
        ],
      },
      { type: "pageBreak", attrs: { suggestionInsert: meta("p") } },
      {
        type: "paragraph",
        content: [
          text("Claim"),
          { type: "footnote", attrs: { content: [{ type: "paragraph", content: [text("Source")] }] }, marks: [{ type: "suggestionDelete", attrs: meta("f") }] },
        ],
      },
    ],
  });

describe("Word export and import of structural suggestions", () => {
  it("writes inserted and deleted rows, images, breaks, footnotes and header text as tracked changes", async () => {
    const zip = await JSZip.loadAsync(await toDocx(structural(), "Doc", async () => PNG));
    const xml = await zip.file("word/document.xml")!.async("string");
    // Rows: w:ins / w:del in the row properties, their text inserted or deleted too.
    expect(xml).toMatch(/<w:trPr><w:del w:id="\d+" w:author="You" w:date="[^"]+"\/><\/w:trPr>.*?<w:delText xml:space="preserve">Old<\/w:delText>/);
    expect(xml).toMatch(/<w:trPr><w:ins w:id="\d+" w:author="You" w:date="[^"]+"\/><\/w:trPr>.*?<w:ins [^>]*><w:r>.*?<w:t xml:space="preserve">New<\/w:t>/);
    // The image's run in w:ins, and its paragraph mark inserted with it.
    expect(xml).toMatch(/<w:pPr><w:rPr><w:ins [^>]*\/><\/w:rPr><\/w:pPr><w:ins w:id="\d+" w:author="You" w:date="[^"]+"><w:r>(<w:rPr\/>)?<w:drawing>/);
    expect(xml).toMatch(/<w:ins [^>]*><w:r><w:br w:type="page"\/><\/w:r><\/w:ins>/);
    expect(xml).toMatch(/<w:del [^>]*><w:r><w:rPr><w:rStyle w:val="FootnoteReference"\/><\/w:rPr><w:footnoteReference w:id="1"\/><\/w:r><\/w:del>/);
    const header = await zip.file(/word\/header\d*\.xml/)[0]!.async("string");
    expect(header).toMatch(/<w:ins [^>]*><w:r>.*?<w:t xml:space="preserve">Draft<\/w:t>/);
    const footnotes = await zip.file("word/footnotes.xml")!.async("string");
    expect(footnotes).toMatch(/<w:delText xml:space="preserve">Source<\/w:delText>/);
  });

  it("reads them back as the same suggestions", async () => {
    const data = await toDocx(structural(), "Doc", async () => PNG);
    const { doc } = await docxToDocument(new Uint8Array(data), { storeImage: async () => "/uploads/b.png" });
    const imported = Node.fromJSON(documentSchema, doc.toJSON());
    expect(descriptions(imported)).toEqual([
      "Add: “Draft”",
      "Add: Image",
      "Delete: Table row",
      "Add: Table row",
      "Add: Page break",
      "Delete: Footnote",
    ]);
    const [header] = collectSuggestions(imported);
    expect(header!.region?.key).toBe("header");
    // The image's own paragraph mark does not become a paragraph break around it.
    expect(imported.child(0).textContent).toBe("Intro");
    expect(imported.child(1).type.name).toBe("image");
    expect(imported.child(2).type.name).toBe("table");
  });
});

describe("suggestions on the server", () => {
  let db: Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = openDatabase(":memory:");
    app = createApp({ db, uploadsDir: mkdtempSync(join(tmpdir(), "docs-uploads-")) });
  });

  it("stores replies on a suggestion and returns them with the document", async () => {
    const { id } = (await (await app.request("/api/documents", { method: "POST" })).json()) as DocumentSummary;
    const post = (body: string) =>
      app.request(`/api/documents/${id}/suggestions/abc/replies`, { method: "POST", body: JSON.stringify({ body }) });
    expect((await post("  First  ")).status).toBe(201);
    const replies = (await (await post("Second")).json()) as CommentMessage[];
    expect(replies.map((reply) => reply.body)).toEqual(["First", "Second"]);
    expect((await post(" ")).status).toBe(400);

    const opened = (await (await app.request(`/api/documents/${id}`)).json()) as OpenedDocument;
    expect(opened.suggestionReplies.abc?.map((reply) => reply.body)).toEqual(["First", "Second"]);

    const removed = await app.request(`/api/documents/${id}/suggestions/abc/replies/${replies[0]!.id}`, { method: "DELETE" });
    expect(((await removed.json()) as CommentMessage[]).map((reply) => reply.body)).toEqual(["Second"]);
    expect((await app.request(`/api/documents/${id}/suggestions/abc/replies/999`, { method: "DELETE" })).status).toBe(404);
    expect((await app.request(`/api/documents/missing/suggestions/abc/replies`, { method: "POST", body: '{"body":"x"}' })).status).toBe(404);
  });

  it("accepts suggestion steps and searches the accepted text", () => {
    const { id } = createDocument(db, "Searchable", 0, suggested());
    expect(listDocuments(db, { query: "Second item" })).toHaveLength(0);
    expect(listDocuments(db, { query: "suggested" }).map((summary) => summary.id)).toEqual([id]);

    const step = new AddMarkStep(1, 6, documentSchema.marks.suggestionDelete!.create(meta("e")));
    expect(applySteps(db, id, { clientId: "c", version: 0, steps: [step.toJSON()] })).toMatchObject({ kind: "applied", version: 1 });
    const invalid = { ...step.toJSON(), mark: { type: "suggestionDelete", attrs: { id: "", author: "You", createdAt: 0 } } };
    expect(() => applySteps(db, id, { clientId: "c", version: 1, steps: [invalid] })).toThrow();
  });
});
