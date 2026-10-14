import { documentSchema, toMarkdown } from "@docs/shared";
import { Node } from "@tiptap/pm/model";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { halfPoints, hexColor, toDocx } from "./docx.ts";

const text = (value: string, marks: { type: string; attrs?: Record<string, unknown> }[] = []) => ({
  type: "text",
  text: value,
  ...(marks.length > 0 && { marks }),
});
const paragraph = (...content: unknown[]) => ({ type: "paragraph", content });
const cell = (type: string, value: string) => ({ type, content: [paragraph(text(value))] });

const sample = Node.fromJSON(documentSchema, {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [text("Title")] },
    paragraph(
      text("Plain, "),
      text("bold ", [{ type: "bold" }]),
      text("both", [{ type: "bold" }, { type: "italic" }]),
      text(", a "),
      text("link", [{ type: "link", attrs: { href: "https://example.com" } }]),
      text(" and "),
      text("underline", [{ type: "underline" }]),
    ),
    {
      type: "bulletList",
      content: [
        { type: "listItem", content: [paragraph(text("One"))] },
        {
          type: "listItem",
          content: [
            paragraph(text("Two")),
            { type: "orderedList", attrs: { start: 1 }, content: [{ type: "listItem", content: [paragraph(text("Nested"))] }] },
          ],
        },
      ],
    },
    {
      type: "table",
      content: [
        { type: "tableRow", content: [cell("tableHeader", "Name"), cell("tableHeader", "Note")] },
        { type: "tableRow", content: [cell("tableCell", "A|B"), cell("tableCell", "ok")] },
      ],
    },
    { type: "codeBlock", attrs: { language: "ts" }, content: [text("const x = 1;")] },
    { type: "image", attrs: { src: "/uploads/missing.png", alt: "Chart" } },
    paragraph(text("After the image")),
  ],
});

describe("toMarkdown", () => {
  it("converts headings, nested marks, links, lists, tables, code and images", () => {
    expect(toMarkdown(sample)).toBe(
      [
        "# Title",
        "",
        "Plain, **bold *both***, a [link](https://example.com) and <u>underline</u>",
        "",
        "- One",
        "- Two",
        "  1. Nested",
        "",
        "| Name | Note |",
        "| --- | --- |",
        "| A\\|B | ok |",
        "",
        "```ts",
        "const x = 1;",
        "```",
        "",
        "![Chart](/uploads/missing.png)",
        "",
        "After the image",
        "",
      ].join("\n"),
    );
  });
});

/** A document using the paragraph styles, spacing, list presets, checklists and page breaks. */
const formatted = Node.fromJSON(documentSchema, {
  type: "doc",
  content: [
    { type: "paragraph", attrs: { paragraphStyle: "title" }, content: [text("The title")] },
    { type: "paragraph", attrs: { paragraphStyle: "subtitle" }, content: [text("The subtitle")] },
    { type: "heading", attrs: { level: 4 }, content: [text("Fourth")] },
    { type: "heading", attrs: { level: 6, spaceBefore: 0 }, content: [text("Sixth")] },
    paragraph(
      text("E = mc"),
      text("2", [{ type: "superscript" }]),
      text(" and H"),
      text("2", [{ type: "subscript" }]),
      text("O"),
    ),
    { type: "paragraph", attrs: { spaceBefore: 10, spaceAfter: 24 }, content: [text("Spaced")] },
    { type: "pageBreak" },
    {
      type: "bulletList",
      attrs: { listPreset: 3 },
      content: [
        {
          type: "listItem",
          content: [
            paragraph(text("Star")),
            { type: "bulletList", content: [{ type: "listItem", content: [paragraph(text("Circle"))] }] },
          ],
        },
      ],
    },
    {
      type: "orderedList",
      attrs: { start: 1, listPreset: 3 },
      content: [{ type: "listItem", content: [paragraph(text("Outline number"))] }],
    },
    {
      type: "taskList",
      attrs: { listPreset: 1 },
      content: [
        { type: "taskItem", attrs: { checked: true }, content: [paragraph(text("Done"))] },
        { type: "taskItem", attrs: { checked: false }, content: [paragraph(text("To do"))] },
      ],
    },
  ],
});

describe("toMarkdown with paragraph styles and checklists", () => {
  it("writes Title as a level 1 heading, Subtitle as a paragraph and checklists as task items", () => {
    expect(toMarkdown(formatted)).toBe(
      [
        "# The title",
        "",
        "The subtitle",
        "",
        "#### Fourth",
        "",
        "###### Sixth",
        "",
        "E = mc<sup>2</sup> and H<sub>2</sub>O",
        "",
        "Spaced",
        "",
        "<!-- page break -->",
        "",
        "- Star",
        "  - Circle",
        "",
        "1. Outline number",
        "",
        "- [x] Done",
        "- [ ] To do",
        "",
      ].join("\n"),
    );
  });
});

async function documentXml(buffer: Buffer, file: string): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  return zip.file(file)!.async("string");
}

describe("toDocx", () => {
  it("uses Word's Title, Subtitle and Heading styles with the editor's sizes and spacing", async () => {
    const buffer = await toDocx(formatted, "Formatted", async () => null);
    const body = await documentXml(buffer, "word/document.xml");
    const styles = await documentXml(buffer, "word/styles.xml");

    for (const style of ["Title", "Subtitle", "Heading4", "Heading6"]) {
      expect(body).toContain(`<w:pStyle w:val="${style}"/>`);
      expect(styles).toContain(`w:styleId="${style}"`);
    }
    // Title is 26pt (52 half-points) with 3pt (60 twips) after; Heading 6 is italic and grey.
    const titleStyle = styles.slice(styles.indexOf('w:styleId="Title"'));
    expect(titleStyle.slice(0, titleStyle.indexOf("</w:style>"))).toMatch(/w:after="60"[\s\S]*<w:sz w:val="52"\/>/);
    const sixth = styles.slice(styles.indexOf('w:styleId="Heading6"'));
    expect(sixth.slice(0, sixth.indexOf("</w:style>"))).toMatch(/<w:i\/>[\s\S]*<w:color w:val="666666"\/>/);

    expect(body).toContain('<w:vertAlign w:val="superscript"/>');
    expect(body).toContain('<w:vertAlign w:val="subscript"/>');
    expect(body).toMatch(/<w:spacing w:after="480" w:before="200"\/>/);
    expect(body).toMatch(/<w:spacing w:before="0"\/>/);
    expect(body).toContain('<w:br w:type="page"/>');
    expect(body).toContain("☑ ");
    expect(body).toContain("☐ ");
    expect(body).toContain("<w:strike/>");
    // Text without its own italics or bold inherits the style's (Heading 6 is italic).
    expect(body).not.toContain('<w:i w:val="false"/>');
  });

  it("writes the bullet glyphs and numbering of the list presets", async () => {
    const buffer = await toDocx(formatted, "Formatted", async () => null);
    const numbering = await documentXml(buffer, "word/numbering.xml");
    expect(numbering).toContain('<w:lvlText w:val="★"/>');
    expect(numbering).toContain('<w:lvlText w:val="%1.%2.%3."/>');
    expect(numbering).toContain('<w:numFmt w:val="upperLetter"/>');
    expect(numbering).toContain('<w:numFmt w:val="upperRoman"/>');
    expect(numbering).toContain('<w:numFmt w:val="decimalZero"/>');
    for (const glyph of ["❏", "➔", "➢"]) expect(numbering).toContain(`<w:lvlText w:val="${glyph}"/>`);
  });

  it("numbers lists with the preset stored as an id or as an index in the old order", async () => {
    const list = (listPreset: unknown) => ({
      type: "orderedList",
      attrs: { start: 1, listPreset },
      content: [{ type: "listItem", content: [paragraph(text("Item"))] }],
    });
    const doc = Node.fromJSON(documentSchema, { type: "doc", content: [list("upper-roman"), list(1)] });
    const numbering = await documentXml(await toDocx(doc, "Lists", async () => null), "word/numbering.xml");
    // Each list gets its own numbering instance pointing at its preset's definition, by preset index.
    const abstractOf = (instance: number) =>
      numbering.match(new RegExp(`<w:num w:numId="${instance}"[^>]*>\\s*<w:abstractNumId w:val="(\\d+)"/>`))?.[1];
    const abstracts = [...numbering.matchAll(/<w:num w:numId="(\d+)"/g)].map((match) => abstractOf(Number(match[1])));
    expect(abstracts.length).toBeGreaterThanOrEqual(2);
    const firstLevel = (abstractId: string | undefined) => {
      const start = numbering.indexOf(`<w:abstractNum w:abstractNumId="${abstractId}"`);
      return numbering.slice(start, numbering.indexOf("</w:lvl>", start));
    };
    const used = abstracts.slice(-2).map(firstLevel);
    expect(used[0]).toContain('<w:numFmt w:val="upperRoman"/>');
    // 1 was "A. a. i." in the old order.
    expect(used[1]).toContain('<w:numFmt w:val="upperLetter"/>');
  });


  it("uses the page size, orientation and margins from page setup", async () => {
    const landscape = Node.fromJSON(documentSchema, {
      type: "doc",
      attrs: { paperSize: "Letter", orientation: "landscape", marginTop: 36, marginBottom: 54, marginLeft: 72, marginRight: 90 },
      content: [{ type: "paragraph" }],
    });
    const body = await documentXml(await toDocx(landscape, "Wide", async () => null), "word/document.xml");
    expect(body).toMatch(/<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"\/>/);
    expect(body).toMatch(/<w:pgMar w:top="720" w:right="1800" w:bottom="1080" w:left="1440"/);

    const a4 = await documentXml(await toDocx(sample, "Sample", async () => null), "word/document.xml");
    expect(a4).toMatch(/<w:pgSz w:w="11906" w:h="16838" w:orient="portrait"\/>/);
  });

  it("writes paragraph indents and the page colour", async () => {
    const doc = Node.fromJSON(documentSchema, {
      type: "doc",
      attrs: { pageColor: "#d9ead3" },
      content: [
        { type: "paragraph", attrs: { indentLeft: 72, indentFirstLine: -18, indentRight: 36 }, content: [text("Hanging")] },
        { type: "heading", attrs: { level: 2, indentFirstLine: 36 }, content: [text("First line")] },
        { type: "paragraph", attrs: { indent: 1 }, content: [text("Old indent")] },
      ],
    });
    const body = await documentXml(await toDocx(doc, "Indents", async () => null), "word/document.xml");
    expect(body).toMatch(/<w:ind w:left="1440" w:right="720" w:hanging="360"\/>/);
    expect(body).toMatch(/<w:ind w:firstLine="720"\/>/);
    expect(body).toMatch(/<w:ind w:left="720"\/>/);
    expect(body).toContain('<w:background w:color="D9EAD3"/>');
    const settings = await documentXml(await toDocx(doc, "Indents", async () => null), "word/settings.xml");
    expect(settings).toContain("<w:displayBackgroundShape/>");

    const white = await documentXml(await toDocx(sample, "Sample", async () => null), "word/document.xml");
    expect(white).not.toContain("<w:background");
  });

  it("uses the image size set in the editor", async () => {
    // A 4 × 2 PNG.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAEUlEQVR42mNk+M9QzwAEjDAGACCDAv8cI7IoAAAAAElFTkSuQmCC",
      "base64",
    );
    const doc = Node.fromJSON(documentSchema, {
      type: "doc",
      content: [
        { type: "image", attrs: { src: "/uploads/a.png", width: 320, height: 100 } },
        { type: "image", attrs: { src: "/uploads/a.png", width: 200 } },
        { type: "image", attrs: { src: "/uploads/a.png" } },
        { type: "image", attrs: { src: "/uploads/a.png", width: 2000, height: 1000 } },
      ],
    });
    const body = await documentXml(await toDocx(doc, "Images", async () => png), "word/document.xml");
    // Word sizes are in EMU: 9525 per pixel. A4 with 2.54 cm margins has 602 px between the margins.
    const extents = [...body.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/g)].map(([, cx, cy]) => [
      Math.round(Number(cx) / 9525),
      Math.round(Number(cy) / 9525),
    ]);
    expect(extents).toEqual([
      [320, 100],
      [200, 100],
      [4, 2],
      [602, 301],
    ]);
  });

  it("exports column widths, row heights, cell backgrounds and borders", async () => {
    const doc = Node.fromJSON(documentSchema, {
      type: "doc",
      content: [
        {
          type: "table",
          attrs: { borderColor: "#cc0000", borderWidth: 1.5 },
          content: [
            {
              type: "tableRow",
              attrs: { height: 40 },
              content: [
                { type: "tableCell", attrs: { colwidth: [300], backgroundColor: "#fff2cc" }, content: [paragraph(text("A"))] },
                { type: "tableCell", attrs: { colwidth: [100] }, content: [paragraph(text("B"))] },
              ],
            },
          ],
        },
        { type: "table", content: [{ type: "tableRow", content: [cell("tableCell", "C"), cell("tableCell", "D")] }] },
      ],
    });
    const body = await documentXml(await toDocx(doc, "Tables", async () => null), "word/document.xml");
    // 602 px between A4's margins is 9026 twips (rounded from the page size in millimetres).
    const grids = [...body.matchAll(/<w:tblGrid>(.*?)<\/w:tblGrid>/g)].map(([, grid]) =>
      [...grid!.matchAll(/w:w="(\d+)"/g)].map(([, width]) => Number(width)),
    );
    expect(grids[0]!.reduce((sum, width) => sum + width, 0)).toBeCloseTo(9026, -1);
    expect(grids[0]![0]! / grids[0]![1]!).toBeCloseTo(3, 2);
    expect(grids[1]![0]).toBe(grids[1]![1]);
    expect(body).toContain('<w:tblLayout w:type="fixed"/>');
    expect(body).toMatch(/<w:trHeight w:val="600" w:hRule="atLeast"\/>/);
    expect(body).toMatch(/<w:shd [^>]*w:fill="FFF2CC"/);
    expect(body).toMatch(/<w:top w:val="single" w:color="CC0000" w:sz="12"/);
  });

  it("produces a Word file and tolerates missing images", async () => {
    const buffer = await toDocx(sample, "Sample", async () => null);
    expect(buffer.subarray(0, 2).toString()).toBe("PK"); // .docx is a zip archive
    expect(buffer.length).toBeGreaterThan(1000);
  });
});

describe("hexColor", () => {
  it("normalises CSS colours for Word", () => {
    expect(hexColor("#abc")).toBe("AABBCC");
    expect(hexColor("#1155cc")).toBe("1155CC");
    expect(hexColor("rgb(255, 0, 16)")).toBe("FF0010");
    expect(hexColor("red")).toBeUndefined();
  });
});

describe("halfPoints", () => {
  it("converts font sizes to Word half-points", () => {
    expect(halfPoints("11pt")).toBe(22);
    expect(halfPoints("16px")).toBe(24);
    expect(halfPoints("big")).toBeUndefined();
  });
});
