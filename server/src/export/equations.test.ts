// Equations in exports and imports (spec 20): Word as Office Math, Markdown as `$…$`.
import { documentSchema, toMarkdown } from "@docs/shared";
import { getText, getTextSerializersFromSchema } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { docxToDocument } from "../import/docx.ts";
import { markdownToDocument } from "../import/markdown.ts";
import { toDocx } from "./docx.ts";

const equation = (latex: string, marks?: unknown[]) => ({ type: "equation", attrs: { latex }, ...(marks && { marks }) });
const paragraph = (...content: unknown[]) => ({ type: "paragraph", content });
const text = (value: string) => ({ type: "text", text: value });
const doc = (...content: unknown[]) => Node.fromJSON(documentSchema, { type: "doc", content });

const noImages = { storeImage: async () => null };

function equations(node: Node): string[] {
  const result: string[] = [];
  node.descendants((child) => {
    if (child.type.name === "equation") result.push(child.attrs.latex as string);
  });
  return result;
}

describe("equations in Word files", () => {
  const latexes = [
    "x^2",
    "\\frac{a+b}{2}",
    "\\sqrt{x}+\\sqrt[3]{y}",
    "\\sum_{i=1}^ni",
    "\\int_a^bf\\left(x\\right)dx",
    "\\lim_{a\\rightarrow b}",
    "\\alpha\\leq\\Gamma",
    "\\hat{x}\\bar{y}\\overline{z}",
    "\\left\\{x\\right\\}\\left[y\\right]\\left|z\\right|",
    "\\sin x",
    "\\begin{pmatrix}1 & 0 \\\\ 0 & 1\\end{pmatrix}",
  ];

  it("are written as Office Math and read back as the same equations", async () => {
    const original = doc(paragraph(text("Area "), ...latexes.map((latex) => equation(latex)), text(" end")));
    const word = await toDocx(original, "Equations", async () => null);
    const xml = await (await JSZip.loadAsync(word)).file("word/document.xml")!.async("string");
    expect(xml).toContain("<m:oMath>");
    expect(xml).toContain("<m:f>");
    expect(xml).toContain('<m:chr m:val="∑"/>');
    const { doc: imported } = await docxToDocument(new Uint8Array(word), noImages);
    expect(equations(imported)).toEqual(latexes);
    expect(imported.textContent).toBe("Area  end");
  });

  it("writes inserted and deleted equations as tracked changes", async () => {
    const meta = { id: "s1", author: "You", createdAt: Date.UTC(2026, 0, 1) };
    const original = doc(
      paragraph(equation("x", [{ type: "suggestionInsert", attrs: meta }]), equation("y", [{ type: "suggestionDelete", attrs: { ...meta, id: "s2" } }])),
    );
    const word = await toDocx(original, "Tracked", async () => null);
    const xml = await (await JSZip.loadAsync(word)).file("word/document.xml")!.async("string");
    expect(xml).toMatch(/<w:ins [^>]*><m:oMath>/);
    expect(xml).toMatch(/<w:del [^>]*><m:oMath>/);
    const { doc: imported } = await docxToDocument(new Uint8Array(word), noImages);
    const marks: string[] = [];
    imported.descendants((node) => {
      if (node.type.name === "equation") marks.push(node.marks.map((mark) => mark.type.name).join());
    });
    expect(marks).toEqual(["suggestionInsert", "suggestionDelete"]);
  });
});

describe("equations in Markdown", () => {
  it("are written as $…$, and a dollar sign in the text is escaped", () => {
    expect(toMarkdown(doc(paragraph(text("Cost $5, "), equation("x^2"), text(" and "), equation("\\frac{a}{b}"))))).toBe(
      "Cost \\$5, $x^2$ and $\\frac{a}{b}$\n",
    );
  });

  it("are read from $…$ and $$…$$; dollar amounts stay text", async () => {
    const { doc: imported } = await markdownToDocument("Area $\\pi r^2$ costs $5 or $10.\n\n$$\\sum_{i=1}^n i$$\n\nEscaped \\$x$ stays.\n", noImages);
    expect(equations(imported)).toEqual(["\\pi r^2", "\\sum_{i=1}^n i"]);
    expect(imported.child(0).textContent).toBe("Area  costs $5 or $10.");
    expect(imported.child(2).textContent).toBe("Escaped $x$ stays.");
  });

  it("round-trip through an export and an import", async () => {
    const original = doc(paragraph(text("A "), equation("\\sqrt[3]{x}+\\alpha"), text(" B")));
    const { doc: imported } = await markdownToDocument(toMarkdown(original), noImages);
    expect(imported.eq(original)).toBe(true);
  });
});

describe("equations in plain text", () => {
  it("are their LaTeX", () => {
    const original = doc(paragraph(text("E = "), equation("mc^2")));
    expect(getText(original, { blockSeparator: "\n", textSerializers: getTextSerializersFromSchema(documentSchema) })).toBe("E = mc^2");
  });
});
