// Real-world Word files (fixtures/corpus, see its README for sources and licences): each one
// imports into a schema-valid document, is stored and reopened unchanged, reaches the server as
// steps like an edit would, and survives a Word export and a second import without losing text or
// structure. Set DOCX_CORPUS_DIR to run the same checks over a larger folder of .docx files.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { commentQuote, documentSchema, emptyDocument, footnotesOf, pageElementsOf, regionKeys, replaceDifference } from "@docs/shared";
import { mathPlainText, parseLatex } from "@docs/shared/equations";
import { Node } from "@tiptap/pm/model";
import JSZip from "jszip";
import { xml2js } from "xml-js";
import { TableMap } from "@tiptap/pm/tables";
import { describe, expect, it } from "vitest";
import { listComments } from "../comments.ts";
import { openDatabase } from "../database.ts";
import { applySteps, createDocument, getDocumentContent, openDocument } from "../documents.ts";
import { toDocx } from "../export/docx.ts";
import { sniffImageType } from "../uploads.ts";
import { ImportError } from "./content.ts";
import { docxToDocument } from "./docx.ts";
import { createImportedDocument } from "./index.ts";

const fixtures = new URL("fixtures/corpus/", import.meta.url).pathname;

function docxFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return docxFiles(path);
    return name.toLowerCase().endsWith(".docx") ? [path] : [];
  });
}

const files = [...docxFiles(fixtures), ...(process.env.DOCX_CORPUS_DIR ? docxFiles(process.env.DOCX_CORPUS_DIR) : [])];

/** Files that are not Word documents (or are damaged beyond reading): refused with a message. */
const refused = new Set(["truncated62886.docx"]);

/** Stores images in memory, so the export can read them back. */
function imageStore() {
  const images = new Map<string, Buffer>();
  return {
    storeImage: async (data: Uint8Array) => {
      if (!sniffImageType(data)) return null;
      const src = `/uploads/image-${images.size + 1}`;
      images.set(src, Buffer.from(data));
      return src;
    },
    readImage: async (src: string) => images.get(src) ?? null,
  };
}

/** Text with every run of white space as one space: what a reader sees, regardless of breaks. */
const normalise = (text: string) => text.replace(/[\s ]+/g, " ").trim();

/** What a leaf node reads as: a space for tabs and line breaks, an equation's characters in reading order. */
function leafText(leaf: Node): string {
  if (leaf.type.name === "tab" || leaf.type.name === "hardBreak") return " ";
  if (leaf.type.name === "equation") return mathPlainText(parseLatex(leaf.attrs.latex as string));
  return "";
}

/** The text of the body, the footnotes and the headers and footers, each normalised. */
function texts(doc: Node): { body: string; footnotes: string[]; regions: string[] } {
  const text = (node: Node) => normalise(node.textBetween(0, node.content.size, " ", leafText));
  const region = (content: unknown) => (Array.isArray(content) ? text(documentSchema.nodeFromJSON({ type: "doc", content })) : "");
  const settings = pageElementsOf(doc);
  return {
    body: text(doc),
    footnotes: footnotesOf(doc).map((footnote) => region(footnote.node.attrs.content)),
    regions: regionKeys.map((key) => region(settings[key])).filter(Boolean),
  };
}

type Counts = Record<"headings" | "titles" | "listItems" | "tables" | "rows" | "images" | "footnotes" | "pageBreaks" | "links", number>;

function counts(doc: Node): Counts {
  const result: Counts = { headings: 0, titles: 0, listItems: 0, tables: 0, rows: 0, images: 0, footnotes: 0, pageBreaks: 0, links: 0 };
  doc.descendants((node) => {
    const name = node.type.name;
    if (name === "heading") result.headings++;
    if (name === "paragraph" && node.attrs.paragraphStyle) result.titles++;
    if (name === "listItem" || name === "taskItem") result.listItems++;
    if (name === "table") result.tables++;
    if (name === "tableRow") result.rows++;
    if (name === "image") result.images++;
    if (name === "footnote") result.footnotes++;
    if (name === "pageBreak") result.pageBreaks++;
    if (node.isText && node.marks.some((mark) => mark.type.name === "link")) result.links++;
  });
  return result;
}

/** Every table is a rectangle the table editing commands accept (no overlapping or missing cells). */
function tableProblems(doc: Node): string[] {
  const problems: string[] = [];
  doc.descendants((node) => {
    if (node.type.name !== "table") return true;
    const map = TableMap.get(node);
    if (map.problems) problems.push(...map.problems.map((problem) => problem.type));
    return false;
  });
  return problems;
}

type Xml = { type: string; name?: string; text?: unknown; elements?: Xml[] };

/**
 * The words of a part of a Word file as Word shows them, read straight from its XML: text,
 * deleted text and equation text, without hidden text, field instructions and page number field
 * results (the editor draws page numbers itself), and only one of a drawing's alternatives.
 */
async function wordsOfPart(data: Uint8Array, part: string): Promise<string[]> {
  const zip = await JSZip.loadAsync(data);
  const xml = await zip.file(part)?.async("string");
  if (!xml) return [];
  const root = xml2js(xml, { compact: false, captureSpacesBetweenElements: true }) as Xml;
  let text = "";
  const fields: { instruction: string; page: boolean }[] = [];
  const stack: Xml[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    const name = node.name?.replace(/^\w+:/, "");
    if (node.type === "text") continue;
    if (name === "pPr") continue;
    if (name === "noBreakHyphen") text += "‑";
    if (name === "Fallback" || name === "instrText" || name === "delInstrText") {
      if (name !== "Fallback" && fields.length > 0) fields[fields.length - 1]!.instruction += node.elements?.map((child) => String(child.text ?? "")).join("") ?? "";
      continue;
    }
    if (name === "rPr" && node.elements?.some((child) => child.name?.endsWith(":vanish"))) {
      // Hidden text: skip the rest of its run (pushed below as siblings, so marked by name).
      text += "\u0000";
    }
    if (name === "fldChar") {
      const type = (node as { attributes?: Record<string, string> }).attributes?.["w:fldCharType"];
      if (type === "begin") fields.push({ instruction: "", page: false });
      if (type === "separate" && fields.length > 0) fields[fields.length - 1]!.page = /^\s*(PAGE|NUMPAGES)\b/i.test(fields[fields.length - 1]!.instruction);
      if (type === "end") fields.pop();
      continue;
    }
    if (name === "t" || name === "delText") {
      if (fields.some((field) => field.page)) continue;
      text += node.elements?.map((child) => String(child.text ?? "")).join("") ?? "";
      continue;
    }
    if (name === "p" || name === "tab" || name === "br" || name === "cr" || name === "tc") text += " ";
    if (name === "r") text += "\u0001";
    for (let index = (node.elements?.length ?? 0) - 1; index >= 0; index--) stack.push(node.elements![index]!);
  }
  // A run marked hidden: drop its text (from the marker to the next run).
  text = text.replace(/\u0000[^\u0001]*/g, "").replace(/\u0001/g, "");
  return normalise(text).split(" ").filter(Boolean);
}

/**
 * The words of `expected` that `actual` does not have (as many times). Words are compared by their
 * letters and digits, so an equation's words count however its structure is written.
 */
function missingWords(expected: string[], actual: string): string[] {
  const key = (word: string) => word.replace(/[^\p{L}\p{N}]/gu, "");
  const available = new Map<string, number>();
  for (const word of normalise(actual).split(" ").map(key)) available.set(word, (available.get(word) ?? 0) + 1);
  return expected.map(key).filter((word) => {
    if (!word) return false;
    const count = available.get(word) ?? 0;
    if (count === 0) return true;
    available.set(word, count - 1);
    return false;
  });
}

/** Text of the comments' quotes and messages, and whether they are resolved. */
const commentTexts = (comments: { quote: string; resolved: boolean; messages: { body: string }[] }[]) =>
  comments.map(
    (comment) => `${comment.resolved ? "resolved: " : ""}${normalise(comment.quote)} | ${comment.messages.map((message) => normalise(message.body)).join(" | ")}`,
  );

describe.each(files.map((path) => [path.startsWith(fixtures) ? path.slice(fixtures.length) : path, path]))("%s", (_title, path) => {
  const name = basename(path);
  const data = new Uint8Array(readFileSync(path));

  if (refused.has(name)) {
    it("is refused with a message", async () => {
      await expect(docxToDocument(data, imageStore())).rejects.toBeInstanceOf(ImportError);
    });
    return;
  }

  it("imports, reloads, saves as steps and survives export and import", { timeout: 60_000 }, async () => {
    const images = imageStore();
    const imported = await docxToDocument(data, images);
    const { doc } = imported;
    doc.check();
    expect(tableProblems(doc)).toEqual([]);
    // Nothing the file shows is lost: the body's words are in the body, the footnotes' in the footnotes.
    const imported_ = texts(doc);
    expect(missingWords(await wordsOfPart(data, "word/document.xml"), imported_.body)).toEqual([]);
    // Endnotes become footnotes.
    const notes = [...(await wordsOfPart(data, "word/footnotes.xml")), ...(await wordsOfPart(data, "word/endnotes.xml"))];
    expect(missingWords(notes, imported_.footnotes.join(" "))).toEqual([]);

    // Stored as a new document (with its comments) and opened again.
    const db = openDatabase(":memory:");
    const summary = createImportedDocument(db, name, imported);
    const opened = openDocument(db, summary.id)!;
    const reloaded = Node.fromJSON(documentSchema, opened.content);
    expect(reloaded.eq(doc)).toBe(true);
    expect(opened.comments).toHaveLength(imported.comments.length);

    // The same content made as steps on a blank document, as the server validates edits.
    const blank = createDocument(db, "blank", Date.now(), Node.fromJSON(documentSchema, emptyDocument));
    const steps = replaceDifference(getDocumentContent(db, blank.id)!.doc, doc).steps.map((step) => step.toJSON());
    expect(applySteps(db, blank.id, { clientId: "test", version: 0, steps })).toMatchObject({ kind: "applied" });
    expect(getDocumentContent(db, blank.id)!.doc.eq(doc)).toBe(true);

    // Exported to Word and imported again.
    const comments = listComments(db, summary.id);
    const exported = await toDocx(doc, name, images.readImage, comments);
    const again = await docxToDocument(new Uint8Array(exported), imageStore());
    again.doc.check();
    expect(texts(again.doc)).toEqual(texts(doc));
    expect(counts(again.doc)).toEqual(counts(doc));
    expect(commentTexts(again.comments.map((comment) => ({ ...comment, quote: commentQuote(again.doc, comment.from, comment.to) })))).toEqual(commentTexts(comments));
  });
});
