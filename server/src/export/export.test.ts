import { documentSchema } from "@docs/shared";
import { Node } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";
import { hexColor, toDocx } from "./docx.ts";
import { toMarkdown } from "./markdown.ts";

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

describe("toDocx", () => {
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
