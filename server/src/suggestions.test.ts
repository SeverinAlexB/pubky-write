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
} from "@docs/shared";
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
