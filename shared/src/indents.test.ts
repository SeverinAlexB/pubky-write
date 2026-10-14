import { Node, type TagParseRule } from "@tiptap/pm/model";
import { Step } from "@tiptap/pm/transform";
import { describe, expect, it } from "vitest";
import { indentAttributes, paragraphIndents, steppedIndent } from "./indents.ts";
import { documentSchema } from "./schema.ts";

const text = (value: string) => ({ type: "text", text: value });

/** The style attribute the editor renders for a block. */
function renderedStyle(node: Node): string | undefined {
  const spec = node.type.spec.toDOM!(node) as [string, Record<string, string>, ...unknown[]];
  return spec[1]?.style;
}

/** Parses a <p> with the given inline style, without a browser. */
function parseParagraph(style: Record<string, string>): Record<string, unknown> {
  const element = {
    style: { ...style, getPropertyValue: (name: string) => style[name] ?? "" },
    getAttribute: () => null,
    hasAttribute: () => false,
  };
  const rule = documentSchema.nodes.paragraph!.spec.parseDOM!.find((candidate) => (candidate as TagParseRule).tag === "p") as TagParseRule;
  return (rule.getAttrs!(element as never) || {}) as Record<string, unknown>;
}

describe("paragraph indents", () => {
  it("count the old half-inch indent levels towards the left indent", () => {
    // Saved before indents in points existed.
    const old = Node.fromJSON(documentSchema, {
      type: "doc",
      content: [{ type: "paragraph", attrs: { textAlign: "center", lineSpacing: 1.5, indent: 2 }, content: [text("Old")] }],
    });
    expect(() => old.check()).not.toThrow();
    const paragraph = old.child(0);
    expect(paragraph.attrs).toMatchObject({ indent: 2, indentLeft: 0, indentFirstLine: 0, indentRight: 0 });
    expect(paragraphIndents(paragraph.attrs)).toEqual({ left: 72, firstLine: 0, right: 0 });
    // 72pt is the 96px the old documents were drawn with.
    expect(renderedStyle(paragraph)).toContain("margin-left: 72pt");
  });

  it("render the left, first line and right indents", () => {
    const paragraph = documentSchema.nodes.paragraph!.create({ indentLeft: 56.7, indentFirstLine: -28.35, indentRight: 18 });
    expect(renderedStyle(paragraph)).toBe("margin-left: 56.7pt; text-indent: -28.35pt; margin-right: 18pt");
    expect(renderedStyle(documentSchema.nodes.paragraph!.create())).toBeUndefined();
    const heading = documentSchema.nodes.heading!.create({ level: 2, indentFirstLine: 36 });
    expect(renderedStyle(heading)).toBe("text-indent: 36pt");
  });

  it("are written whole to the new attributes", () => {
    expect(indentAttributes({ left: 72.004, firstLine: -18, right: 0 })).toEqual({
      indent: 0,
      indentLeft: 72,
      indentFirstLine: -18,
      indentRight: 0,
    });
    expect(indentAttributes({ left: 99999, firstLine: -99999, right: -0 }).indentLeft).toBe(1584);
    expect(Object.is(indentAttributes({ left: -0.001, firstLine: 0, right: 0 }).indentLeft, 0)).toBe(true);
  });

  it("step to the next half inch with Tab and Shift+Tab", () => {
    expect(steppedIndent(0, 1)).toBe(36);
    expect(steppedIndent(36, 1)).toBe(72);
    // From a dragged indent to the next stop either way.
    expect(steppedIndent(50, 1)).toBe(72);
    expect(steppedIndent(50, -1)).toBe(36);
    expect(steppedIndent(36, -1)).toBe(0);
    expect(steppedIndent(0, -1)).toBe(0);
    // At most eight steps; a larger dragged indent is left alone by Tab.
    expect(steppedIndent(288, 1)).toBe(288);
    expect(steppedIndent(300, 1)).toBe(300);
  });

  it("parse pasted HTML in pixels or points", () => {
    expect(parseParagraph({ "margin-left": "96px", "text-indent": "-24px" })).toMatchObject({
      indent: 0,
      indentLeft: 72,
      indentFirstLine: -18,
      indentRight: 0,
    });
    expect(parseParagraph({ "margin-left": "56.7pt", "margin-right": "18pt" })).toMatchObject({ indentLeft: 56.7, indentRight: 18 });
    expect(parseParagraph({ "margin-left": "auto" })).toMatchObject({ indentLeft: 0 });
  });

  it("apply steps stored before and after indents in points", () => {
    let doc = Node.fromJSON(documentSchema, { type: "doc", content: [{ type: "paragraph", content: [text("Text")] }] });
    for (const json of [
      { stepType: "attr", pos: 0, attr: "indent", value: 3 },
      { stepType: "attr", pos: 0, attr: "indentLeft", value: 20 },
      { stepType: "attr", pos: 0, attr: "indentFirstLine", value: -10 },
    ]) {
      const result = Step.fromJSON(documentSchema, json).apply(doc);
      expect(result.failed).toBeNull();
      doc = result.doc!;
    }
    expect(paragraphIndents(doc.child(0).attrs)).toEqual({ left: 128, firstLine: -10, right: 0 });
    expect(Node.fromJSON(documentSchema, JSON.parse(JSON.stringify(doc.toJSON()))).eq(doc)).toBe(true);
  });

  it("reject invalid indents", () => {
    const doc = Node.fromJSON(documentSchema, { type: "doc", content: [{ type: "paragraph", content: [text("Text")] }] });
    for (const value of ["72", 99999, Number.NaN, null]) {
      const step = Step.fromJSON(documentSchema, { stepType: "attr", pos: 0, attr: "indentLeft", value });
      expect(() => step.apply(doc).doc?.check()).toThrow();
    }
  });
});
