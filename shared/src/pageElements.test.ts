import { Node } from "@tiptap/pm/model";
import { Step, Transform } from "@tiptap/pm/transform";
import { describe, expect, it } from "vitest";
import { footnotesOf, isEmptyRegion, pageElementsOf, regionFor, regionKeyFor, regionText } from "./pageElements.ts";
import { documentSchema } from "./schema.ts";
import { headingSlug, tableOfContents, tocEntries, tocTarget, TOC_PLACEHOLDER } from "./tableOfContents.ts";
import { replaceDifference } from "./versionDiff.ts";

const text = (value: string) => ({ type: "text", text: value });
const paragraph = (value: string) => ({ type: "paragraph", content: [text(value)] });
const footnote = (value: string) => ({ type: "footnote", attrs: { content: [paragraph(value)] } });

/** Steps survive a trip through JSON, as they do between the editor and the server. */
function viaJson(step: Step): Step {
  return Step.fromJSON(documentSchema, JSON.parse(JSON.stringify(step.toJSON())));
}

describe("page element schema", () => {
  it("loads documents saved before headers, footers and footnotes existed with the defaults", () => {
    const doc = Node.fromJSON(documentSchema, { type: "doc", attrs: { paperSize: "Letter" }, content: [paragraph("Old")] });
    expect(() => doc.check()).not.toThrow();
    expect(pageElementsOf(doc)).toEqual({
      header: null,
      footer: null,
      firstPageHeader: null,
      firstPageFooter: null,
      differentFirstPage: false,
      pageNumberStart: 1,
    });
  });

  it("sets headers and footers with document attribute steps", () => {
    const doc = Node.fromJSON(documentSchema, { type: "doc", content: [paragraph("Body")] });
    const header = [{ type: "paragraph", attrs: { textAlign: "right" }, content: [text("Page "), { type: "pageField", attrs: { kind: "page" } }] }];
    const transform = new Transform(doc).setDocAttribute("header", header).setDocAttribute("differentFirstPage", true);
    const result = transform.steps.map(viaJson).reduce((current, step) => step.apply(current).doc!, doc);
    expect(result.attrs.header).toEqual(header);
    expect(regionFor(pageElementsOf(result), "header", 1)).toEqual(header);
    // Page 1 has its own (empty) header.
    expect(regionFor(pageElementsOf(result), "header", 0)).toBeNull();
    expect(regionKeyFor("header", 0, true)).toBe("firstPageHeader");
    const reloaded = Node.fromJSON(documentSchema, JSON.parse(JSON.stringify(result.toJSON())));
    expect(reloaded.eq(result)).toBe(true);
    expect(regionText(documentSchema, header)).toBe("Page ");
  });

  it("rejects invalid header content and settings", () => {
    const doc = Node.fromJSON(documentSchema, { type: "doc", content: [paragraph("Body")] });
    for (const [attr, value] of [
      ["header", []],
      ["header", "text"],
      ["footer", [{ type: "pageBreak" }]],
      ["header", [{ type: "paragraph", content: [footnote("Nested")] }]],
      ["header", [{ type: "unknown" }]],
      ["differentFirstPage", "yes"],
      ["pageNumberStart", -1],
      ["pageNumberStart", 1.5],
    ] as const) {
      const step = Step.fromJSON(documentSchema, { stepType: "docAttr", attr, value });
      expect(() => step.apply(doc), `${attr} = ${JSON.stringify(value)}`).toThrow();
    }
  });

  it("keeps footnote text on the reference and changes it with an attribute step", () => {
    const doc = Node.fromJSON(documentSchema, {
      type: "doc",
      content: [{ type: "paragraph", content: [text("One"), footnote("First"), text(" two"), footnote("Second")] }],
    });
    const notes = footnotesOf(doc);
    expect(notes.map((note) => regionText(documentSchema, note.node.attrs.content))).toEqual(["First", "Second"]);
    // A reference counts as one character, like an image.
    expect(doc.textBetween(0, doc.content.size, "\n", "*")).toBe("One* two*");

    const step = viaJson(new Transform(doc).setNodeAttribute(notes[1]!.pos, "content", [paragraph("Changed")]).steps[0]!);
    const result = step.apply(doc).doc!;
    expect(regionText(documentSchema, footnotesOf(result)[1]!.node.attrs.content)).toBe("Changed");
    expect(step.getMap().map(5)).toBe(5);

    const invalid = Step.fromJSON(documentSchema, { stepType: "attr", pos: notes[0]!.pos, attr: "content", value: [{ type: "pageBreak" }] });
    expect(() => invalid.apply(doc)).toThrow();
  });

  it("numbers footnotes in document order, so inserting one renumbers the rest", () => {
    const doc = Node.fromJSON(documentSchema, {
      type: "doc",
      content: [{ type: "paragraph", content: [text("A"), footnote("a"), text("B"), footnote("b")] }],
    });
    const inserted = new Transform(doc).insert(1, documentSchema.nodeFromJSON(footnote("new"))).doc;
    expect(footnotesOf(inserted).map((note) => regionText(documentSchema, note.node.attrs.content))).toEqual(["new", "a", "b"]);
  });

  it("treats empty paragraphs as no header", () => {
    expect(isEmptyRegion([{ type: "paragraph" }, { type: "paragraph", content: [] }])).toBe(true);
    expect(isEmptyRegion([{ type: "paragraph", content: [{ type: "pageField" }] }])).toBe(false);
    expect(isEmptyRegion(null)).toBe(true);
  });

  it("restores headers, footers and footnotes from a version", () => {
    const before = Node.fromJSON(documentSchema, {
      type: "doc",
      attrs: { header: [paragraph("Old header")], pageNumberStart: 3 },
      content: [{ type: "paragraph", content: [text("Body"), footnote("Old note")] }],
    });
    const after = Node.fromJSON(documentSchema, {
      type: "doc",
      attrs: { footer: [paragraph("Footer")] },
      content: [{ type: "paragraph", content: [text("Body"), footnote("New note")] }],
    });
    const restored = replaceDifference(after, before).doc;
    expect(restored.eq(before)).toBe(true);
  });
});

describe("table of contents", () => {
  const doc = Node.fromJSON(documentSchema, {
    type: "doc",
    content: [
      { type: "paragraph", attrs: { paragraphStyle: "title" }, content: [text("Report")] },
      { type: "heading", attrs: { level: 1 }, content: [text("Introduction")] },
      paragraph("Body"),
      { type: "heading", attrs: { level: 2 }, content: [text("Background")] },
      { type: "heading", attrs: { level: 1 }, content: [] },
      { type: "heading", attrs: { level: 3 }, content: [text("Details")] },
      { type: "heading", attrs: { level: 1 }, content: [text("Introduction")] },
    ],
  });

  it("lists the Title and headings with text, indented per level below the highest", () => {
    const entries = tocEntries(doc, (pos) => (pos < 25 ? 1 : 2));
    expect(entries.map((entry) => [entry.content![0]!.text, entry.attrs!.indent, entry.attrs!.page])).toEqual([
      ["Report", 0, 1],
      ["Introduction", 1, 1],
      ["Background", 2, 2],
      ["Details", 3, 2],
      ["Introduction", 1, 2],
    ]);
  });

  it("starts at the highest level present", () => {
    const headingsOnly = Node.fromJSON(documentSchema, {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [text("Two")] },
        { type: "heading", attrs: { level: 3 }, content: [text("Three")] },
      ],
    });
    expect(tocEntries(headingsOnly).map((entry) => entry.attrs!.indent)).toEqual([0, 1]);
  });

  it("shows a hint when there are no headings", () => {
    const empty = Node.fromJSON(documentSchema, { type: "doc", content: [paragraph("Text")] });
    expect(tocEntries(empty)).toEqual([{ type: "tocEntry", content: [text(TOC_PLACEHOLDER)] }]);
  });

  it("is a valid block that links entries to their headings", () => {
    const toc = documentSchema.nodeFromJSON(tableOfContents(doc, "links"));
    const withToc = new Transform(doc).insert(0, toc).doc;
    expect(() => withToc.check()).not.toThrow();
    const inserted = withToc.child(0);
    // The second "Introduction" entry links to the second heading with that text.
    expect(tocTarget(withToc, inserted, 4)?.pos).toBe(withToc.child(withToc.childCount - 1) && lastHeadingPos(withToc));
    expect(tocTarget(withToc, inserted, 1)?.text).toBe("Introduction");
    // Headings inside the table itself are not listed again.
    expect(tocEntries(withToc)).toHaveLength(5);
  });

  it("makes Markdown anchors from heading text", () => {
    expect(headingSlug("My first heading!")).toBe("my-first-heading");
  });
});

function lastHeadingPos(doc: Node): number {
  let pos = 0;
  doc.forEach((_node, offset) => {
    pos = offset;
  });
  return pos;
}
