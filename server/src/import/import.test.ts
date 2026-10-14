import { readFile } from "node:fs/promises";
import { documentSchema, regionText, toMarkdown } from "@docs/shared";
import { Node } from "@tiptap/pm/model";
import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  FootnoteReferenceRun,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageBreak,
  PageOrientation,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalMergeType,
} from "docx";
import { describe, expect, it } from "vitest";
import { toDocx } from "../export/docx.ts";
import { sniffImageType } from "../uploads.ts";
import { ImportError } from "./content.ts";
import { docxToDocument } from "./docx.ts";
import { importedTitle, importFile, isImportable } from "./index.ts";
import { markdownToDocument } from "./markdown.ts";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

/** Stores images in memory and names them by number. */
function imageStore() {
  const stored: Uint8Array[] = [];
  return {
    stored,
    storeImage: async (data: Uint8Array) => {
      if (!sniffImageType(data)) return null;
      stored.push(data);
      return `/uploads/image-${stored.length}.png`;
    },
  };
}

/** The document's structure, one line per block, indented by nesting: "h1: Title", "bulletList", "  listItem". */
function outline(doc: Node): string[] {
  const lines: string[] = [];
  const label = (node: Node) => {
    const { attrs } = node;
    switch (node.type.name) {
      case "heading":
        return `h${attrs.level}`;
      case "paragraph":
        return attrs.paragraphStyle ?? "p";
      case "orderedList":
        return attrs.start === 1 ? "orderedList" : `orderedList start=${attrs.start}`;
      case "taskItem":
        return attrs.checked ? "taskItem [x]" : "taskItem [ ]";
      case "tableCell":
      case "tableHeader": {
        const span = [attrs.colspan > 1 && `colspan=${attrs.colspan}`, attrs.rowspan > 1 && `rowspan=${attrs.rowspan}`].filter(Boolean);
        return [node.type.name, ...span].join(" ");
      }
      default:
        return node.type.name;
    }
  };
  const walk = (node: Node, depth: number) => {
    const pad = "  ".repeat(depth);
    if (node.isTextblock) lines.push(`${pad}${label(node)}: ${node.textContent}`);
    else {
      lines.push(`${pad}${label(node)}`);
      node.forEach((child) => walk(child, depth + 1));
    }
  };
  doc.forEach((block) => walk(block, 0));
  return lines;
}

/** The marks (with attributes where they matter) on the text node holding `text`. */
function marksOn(doc: Node, text: string): string[] {
  let found: string[] | null = null;
  doc.descendants((node) => {
    if (found || !node.isText || !node.text!.includes(text)) return;
    found = node.marks.map((mark) => {
      if (mark.type.name === "link") return `link(${mark.attrs.href})`;
      if (mark.type.name === "textStyle") {
        const attrs = Object.entries(mark.attrs).filter(([, value]) => value);
        return `textStyle(${attrs.map(([key, value]) => `${key}=${value}`).join(",")})`;
      }
      if (mark.type.name === "highlight") return `highlight(${mark.attrs.color})`;
      return mark.type.name;
    });
  });
  if (!found) throw new Error(`No text "${text}"`);
  return found;
}

describe("markdownToDocument", () => {
  it("converts the fixture's headings, marks, lists, quotes, page breaks, tables, code and images", async () => {
    const images = imageStore();
    const source = await readFile(new URL("fixtures/sample.md", import.meta.url), "utf8");
    const { doc, dropped } = await markdownToDocument(source, { storeImage: images.storeImage });

    expect(outline(doc)).toEqual([
      "h1: Quarterly report",
      "p: An introduction with bold, italic, struck, underlined, code, H2O, x2 and a link.",
      "h2: Lists",
      "bulletList",
      "  listItem",
      "    p: First",
      "  listItem",
      "    p: Second",
      "    orderedList",
      "      listItem",
      "        p: Nested one",
      "      listItem",
      "        p: Nested two",
      "  listItem",
      "    p: Third",
      "orderedList start=3",
      "  listItem",
      "    p: Three",
      "  listItem",
      "    p: Four",
      "taskList",
      "  taskItem [ ]",
      "    p: Open task",
      "  taskItem [x]",
      "    p: Done task",
      "blockquote",
      "  p: A quote",
      "pageBreak",
      "h2: Table",
      "table",
      "  tableRow",
      "    tableHeader",
      "      p: Name",
      "    tableHeader",
      "      p: Score",
      "  tableRow",
      "    tableCell",
      "      p: Ada",
      "    tableCell",
      "      p: 10",
      "  tableRow",
      "    tableCell",
      "      p: Bob",
      "    tableCell",
      "      p: 7",
      "codeBlock: const x = 1;",
      "horizontalRule",
      "image",
      "p: Last line",
    ]);
    expect(marksOn(doc, "bold")).toEqual(["bold"]);
    expect(marksOn(doc, "italic")).toEqual(["italic"]);
    expect(marksOn(doc, "struck")).toEqual(["strike"]);
    expect(marksOn(doc, "underlined")).toEqual(["underline"]);
    expect(marksOn(doc, "code")).toEqual(["code"]);
    expect(marksOn(doc, "2")).toEqual(["subscript"]);
    expect(marksOn(doc, "link")).toEqual(["link(https://example.com)"]);
    // Right-aligned column.
    expect(doc.nodeAt(findText(doc, "10") - 1)?.attrs.textAlign).toBe("right");
    expect(images.stored).toHaveLength(1);
    expect(findNode(doc, "image")?.attrs).toMatchObject({ src: "/uploads/image-1.png", alt: "Logo" });
    expect(dropped).toEqual(["Images from local files", "HTML"]);
  });

  it("reads back what the Markdown export writes", async () => {
    const original = Node.fromJSON(documentSchema, {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Plan" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Mixed " },
            { type: "text", text: "marks", marks: [{ type: "bold" }, { type: "underline" }] },
          ],
        },
        {
          type: "taskList",
          content: [{ type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "Ship" }] }] }],
        },
        { type: "pageBreak" },
        { type: "paragraph", content: [{ type: "text", text: "After" }] },
      ],
    });
    const { doc } = await markdownToDocument(toMarkdown(original), { storeImage: imageStore().storeImage });
    expect(outline(doc)).toEqual(outline(original));
    expect(marksOn(doc, "marks")).toEqual(["bold", "underline"]);
  });

  it("uses the requested paper size and makes an empty file one empty paragraph", async () => {
    const { doc } = await markdownToDocument("", { storeImage: imageStore().storeImage, paperSize: "Letter" });
    expect(outline(doc)).toEqual(["p: "]);
    expect(doc.attrs.paperSize).toBe("Letter");
  });

  it("starts list items with a paragraph when they begin with an image", async () => {
    const { doc } = await markdownToDocument("- ![x](https://example.com/a.png)\n", { storeImage: imageStore().storeImage });
    expect(outline(doc)).toEqual(["bulletList", "  listItem", "    p: ", "    image"]);
  });
});

/** A Word file built with the `docx` library, with the features the importer reads and some it drops. */
async function sampleDocx(): Promise<Buffer> {
  const cell = (text: string, options: Partial<ConstructorParameters<typeof TableCell>[0]> = {}) =>
    new TableCell({ children: [new Paragraph(text)], ...options });
  const file = new Document({
    numbering: {
      config: [
        {
          reference: "bullets",
          levels: [0, 1].map((level) => ({ level, format: LevelFormat.BULLET, text: level === 0 ? "●" : "○", alignment: AlignmentType.LEFT })),
        },
        {
          reference: "numbers",
          levels: [{ level: 0, format: LevelFormat.UPPER_ROMAN, text: "%1.", alignment: AlignmentType.LEFT }],
        },
      ],
    },
    footnotes: { 1: { children: [new Paragraph("A footnote")] } },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840, orientation: PageOrientation.LANDSCAPE },
            margin: { top: 720, bottom: 720, left: 1080, right: 1080 },
          },
        },
        headers: { default: new Header({ children: [new Paragraph("Running header")] }) },
        children: [
          new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun("Annual review")] }),
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Introduction")] }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: "Bold", bold: true }),
              new TextRun(" "),
              new TextRun({ text: "Italic", italics: true }),
              new TextRun(" "),
              new TextRun({ text: "Under", underline: {} }),
              new TextRun(" "),
              new TextRun({ text: "Struck", strike: true }),
              new TextRun(" "),
              new TextRun({ text: "Red", color: "FF0000", size: 28 }),
              new TextRun(" "),
              new TextRun({ text: "Up", superScript: true }),
              new TextRun(" "),
              new ExternalHyperlink({ link: "https://example.com", children: [new TextRun({ text: "Website", style: "Hyperlink" })] }),
              new TextRun(" "),
              new TextRun({ text: "Marked", highlight: "yellow" }),
              new FootnoteReferenceRun(1),
            ],
          }),
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Lists")] }),
          new Paragraph({ text: "Apples", numbering: { reference: "bullets", level: 0 } }),
          new Paragraph({ text: "Green apples", numbering: { reference: "bullets", level: 1 } }),
          new Paragraph({ text: "Pears", numbering: { reference: "bullets", level: 0 } }),
          new Paragraph({ text: "Step one", numbering: { reference: "numbers", level: 0 } }),
          new Paragraph({ text: "Step two", numbering: { reference: "numbers", level: 0 } }),
          new Paragraph("Between the steps"),
          new Paragraph({ text: "Step three", numbering: { reference: "numbers", level: 0 } }),
          new Paragraph({ text: "Indented", indent: { left: 1440 } }),
          new Paragraph({ children: [new TextRun("Before the break"), new PageBreak(), new TextRun("After the break")] }),
          new Table({
            rows: [
              new TableRow({ tableHeader: true, children: [cell("Name"), cell("Score")] }),
              new TableRow({ children: [cell("Wide", { columnSpan: 2 })] }),
              new TableRow({ children: [cell("Tall", { verticalMerge: VerticalMergeType.RESTART }), cell("1")] }),
              new TableRow({ children: [cell("", { verticalMerge: VerticalMergeType.CONTINUE }), cell("2")] }),
            ],
          }),
          new Paragraph({
            children: [new ImageRun({ type: "png", data: PNG, transformation: { width: 40, height: 20 }, altText: { name: "Dot", description: "Dot", title: "Dot" } })],
          }),
          new Paragraph({ text: "Fin", spacing: { line: 480, after: 200 } }),
        ],
      },
    ],
  });
  return Packer.toBuffer(file);
}

describe("docxToDocument", () => {
  it("converts styles, marks, links, lists, tables, images, page breaks and the page setup", async () => {
    const images = imageStore();
    const { doc, dropped } = await docxToDocument(await sampleDocx(), { storeImage: images.storeImage, paperSize: "A4" });

    expect(outline(doc)).toEqual([
      "title: Annual review",
      "h1: Introduction",
      "p: Bold Italic Under Struck Red Up Website Marked",
      "h2: Lists",
      "bulletList",
      "  listItem",
      "    p: Apples",
      "    bulletList",
      "      listItem",
      "        p: Green apples",
      "  listItem",
      "    p: Pears",
      "orderedList",
      "  listItem",
      "    p: Step one",
      "  listItem",
      "    p: Step two",
      "p: Between the steps",
      "orderedList start=3",
      "  listItem",
      "    p: Step three",
      "p: Indented",
      "p: Before the break",
      "pageBreak",
      "p: After the break",
      "table",
      "  tableRow",
      "    tableHeader",
      "      p: Name",
      "    tableHeader",
      "      p: Score",
      "  tableRow",
      "    tableCell colspan=2",
      "      p: Wide",
      "  tableRow",
      "    tableCell rowspan=2",
      "      p: Tall",
      "    tableCell",
      "      p: 1",
      "  tableRow",
      "    tableCell",
      "      p: 2",
      "image",
      "p: Fin",
    ]);
    expect(marksOn(doc, "Bold")).toEqual(["bold"]);
    expect(marksOn(doc, "Italic")).toEqual(["italic"]);
    expect(marksOn(doc, "Under")).toEqual(["underline"]);
    expect(marksOn(doc, "Struck")).toEqual(["strike"]);
    expect(marksOn(doc, "Red")).toEqual(["textStyle(color=#ff0000,fontSize=14pt)"]);
    expect(marksOn(doc, "Up")).toEqual(["superscript"]);
    expect(marksOn(doc, "Website")).toEqual(["link(https://example.com)"]);
    expect(marksOn(doc, "Marked")).toEqual(["highlight(#ffff00)"]);

    expect(findNode(doc, "paragraph", "Bold Italic")?.attrs.textAlign).toBe("center");
    expect(findNode(doc, "paragraph", "Indented")?.attrs.indent).toBe(2);
    expect(findNode(doc, "paragraph", "Fin")?.attrs).toMatchObject({ lineSpacing: 2, spaceAfter: 10 });
    expect(findNode(doc, "orderedList")?.attrs.listPreset).toBe("upper-roman");
    expect(findNode(doc, "image")?.attrs).toMatchObject({ src: "/uploads/image-1.png", alt: "Dot", width: 40, height: 20 });
    expect(images.stored).toHaveLength(1);
    expect(doc.attrs).toMatchObject({
      paperSize: "Letter",
      orientation: "landscape",
      marginTop: 36,
      marginBottom: 36,
      marginLeft: 54,
      marginRight: 54,
    });
    // The header and the footnote are read (see the page elements tests below).
    expect(regionText(documentSchema, doc.attrs.header)).toBe("Running header");
    expect(findNode(doc, "footnote")?.attrs.content).toMatchObject([{ type: "paragraph", content: [{ text: "A footnote" }] }]);
    expect(dropped).toEqual([]);
  });

  it("reads back what the Word export writes, including checklists", async () => {
    const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
    const original = Node.fromJSON(documentSchema, {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { paragraphStyle: "title" }, content: [{ type: "text", text: "Title" }] },
        { type: "paragraph", attrs: { paragraphStyle: "subtitle" }, content: [{ type: "text", text: "Subtitle" }] },
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Three" }] },
        { type: "heading", attrs: { level: 6 }, content: [{ type: "text", text: "Six" }] },
        {
          type: "orderedList",
          attrs: { start: 1, listPreset: "outline" },
          content: [{ type: "listItem", content: [paragraph("One")] }, { type: "listItem", content: [paragraph("Two")] }],
        },
        {
          type: "taskList",
          content: [
            { type: "taskItem", attrs: { checked: false }, content: [paragraph("Todo")] },
            { type: "taskItem", attrs: { checked: true }, content: [paragraph("Done")] },
          ],
        },
        {
          type: "table",
          content: [
            { type: "tableRow", content: [{ type: "tableCell", content: [paragraph("A")] }, { type: "tableCell", content: [paragraph("B")] }] },
          ],
        },
        { type: "pageBreak" },
        paragraph("End"),
      ],
    });
    const word = await toDocx(original, "Round trip", async () => null);
    const { doc } = await docxToDocument(word, { storeImage: imageStore().storeImage });
    expect(outline(doc)).toEqual(outline(original));
    expect(findNode(doc, "orderedList")?.attrs.listPreset).toBe("outline");
  });

  it("keeps column widths through an export and import", async () => {
    const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
    const original = Node.fromJSON(documentSchema, {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableCell", attrs: { colwidth: [450] }, content: [paragraph("Wide")] },
                { type: "tableCell", attrs: { colwidth: [150] }, content: [paragraph("Narrow")] },
              ],
            },
          ],
        },
      ],
    });
    const word = await toDocx(original, "Widths", async () => null);
    const { doc } = await docxToDocument(word, { storeImage: imageStore().storeImage });
    const row = findNode(doc, "tableRow")!;
    const [wide, narrow] = [row.child(0).attrs.colwidth[0], row.child(1).attrs.colwidth[0]];
    expect(wide / narrow).toBeCloseTo(3, 1);
  });

  it("rejects files that are not Word documents", async () => {
    await expect(docxToDocument(Buffer.from("not a zip"), { storeImage: imageStore().storeImage })).rejects.toThrow(ImportError);
  });
});

describe("importFile", () => {
  it("accepts .docx and .md files and names the document after the file", async () => {
    expect(isImportable("Notes.MD")).toBe(true);
    expect(isImportable("Report.docx")).toBe(true);
    expect(isImportable("Sheet.xlsx")).toBe(false);
    expect(importedTitle("Q3 plan.final.docx")).toBe("Q3 plan.final");
    const { doc } = await importFile("notes.md", new TextEncoder().encode("# Hi"), { storeImage: imageStore().storeImage });
    expect(outline(doc)).toEqual(["h1: Hi"]);
    await expect(importFile("x.pdf", new Uint8Array(), { storeImage: imageStore().storeImage })).rejects.toThrow(ImportError);
  });
});

function findNode(doc: Node, type: string, text?: string): Node | undefined {
  let found: Node | undefined;
  doc.descendants((node) => {
    if (!found && node.type.name === type && (text === undefined || node.textContent.includes(text))) found = node;
    return !found;
  });
  return found;
}

/** The position of the first text node containing `text`. */
function findText(doc: Node, text: string): number {
  let position = -1;
  doc.descendants((node, pos) => {
    if (position < 0 && node.isText && node.text!.includes(text)) position = pos;
    return position < 0;
  });
  return position;
}
