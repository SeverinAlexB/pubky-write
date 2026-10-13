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
