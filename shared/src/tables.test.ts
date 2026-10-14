import { Node } from "@tiptap/pm/model";
import { Step } from "@tiptap/pm/transform";
import { describe, expect, it } from "vitest";
import { commentQuote } from "./anchors.ts";
import { imageSizeStyle } from "./images.ts";
import { documentSchema } from "./schema.ts";
import { columnFractions, storedColumnWidths, tableStyle } from "./tables.ts";

const text = (value: string) => ({ type: "text", text: value });
const cell = (value: string, attrs?: Record<string, unknown>) => ({
  type: "tableCell",
  ...(attrs && { attrs }),
  content: [{ type: "paragraph", content: value ? [text(value)] : [] }],
});
const table = (rows: unknown[][], attrs?: Record<string, unknown>) =>
  Node.fromJSON(documentSchema, { type: "table", ...(attrs && { attrs }), content: rows.map((content) => ({ type: "tableRow", content })) });

/** A table and an image as stored before column widths, row heights, colours and image sizes were editable. */
const oldDocument = {
  type: "doc",
  content: [
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            { type: "tableHeader", attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: "paragraph", content: [text("Name")] }] },
            { type: "tableHeader", attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: "paragraph", content: [text("Note")] }] },
          ],
        },
        { type: "tableRow", content: [cell("A"), cell("B")] },
      ],
    },
    { type: "image", attrs: { src: "/uploads/a.png", alt: "Chart", title: null } },
  ],
};

describe("table and image attributes", () => {
  it("loads tables and images saved before they had sizes and colours", () => {
    const doc = Node.fromJSON(documentSchema, oldDocument);
    expect(() => doc.check()).not.toThrow();
    const [tableNode, image] = [doc.child(0), doc.child(1)];
    expect(tableNode.attrs).toEqual({ borderColor: null, borderWidth: null });
    expect(tableNode.child(0).attrs.height).toBeNull();
    expect(tableNode.child(1).child(0).attrs.backgroundColor).toBeNull();
    expect(image.attrs).toMatchObject({ width: null, height: null });
    expect(columnFractions(tableNode)).toEqual([0.5, 0.5]);
  });

  it("applies steps that set the new attributes", () => {
    let doc = Node.fromJSON(documentSchema, oldDocument);
    const steps = [
      { stepType: "attr", pos: 0, attr: "borderColor", value: "#ff0000" },
      { stepType: "attr", pos: 0, attr: "borderWidth", value: 1.5 },
      { stepType: "attr", pos: 1, attr: "height", value: 40 },
      { stepType: "attr", pos: 2, attr: "colwidth", value: [200] },
      { stepType: "attr", pos: 2, attr: "backgroundColor", value: "#fff2cc" },
      { stepType: "attr", pos: doc.child(0).nodeSize, attr: "width", value: 320 },
      { stepType: "attr", pos: doc.child(0).nodeSize, attr: "height", value: 100 },
    ];
    for (const json of steps) {
      const applied = Step.fromJSON(documentSchema, json).apply(doc);
      expect(applied.failed).toBeNull();
      doc = applied.doc!;
    }
    expect(() => doc.check()).not.toThrow();
    const reloaded = Node.fromJSON(documentSchema, JSON.parse(JSON.stringify(doc.toJSON())));
    expect(reloaded.eq(doc)).toBe(true);
    expect(reloaded.child(0).attrs).toEqual({ borderColor: "#ff0000", borderWidth: 1.5 });
    expect(reloaded.child(0).child(0).attrs.height).toBe(40);
    expect(reloaded.child(0).child(0).child(0).attrs).toMatchObject({ colwidth: [200], backgroundColor: "#fff2cc" });
    expect(reloaded.child(1).attrs).toMatchObject({ width: 320, height: 100 });
  });
});

describe("column widths", () => {
  it("are equal without stored widths", () => {
    expect(columnFractions(table([[cell("a"), cell("b"), cell("c"), cell("d")]]))).toEqual([0.25, 0.25, 0.25, 0.25]);
  });

  it("are the stored widths' proportions", () => {
    const widths = table([
      [cell("a", { colwidth: [300] }), cell("b", { colwidth: [100] }), cell("c", { colwidth: [200] })],
      [cell("d"), cell("e"), cell("f")],
    ]);
    expect(storedColumnWidths(widths)).toEqual([300, 100, 200]);
    expect(columnFractions(widths)).toEqual([0.5, 1 / 6, 1 / 3]);
  });

  it("read merged cells and give columns without a width the average", () => {
    const merged = table([
      [cell("a", { colspan: 2, colwidth: [100, 300] }), cell("c")],
      [cell("d"), cell("e"), cell("f")],
    ]);
    expect(storedColumnWidths(merged)).toEqual([100, 300, null]);
    expect(columnFractions(merged)).toEqual([100 / 600, 300 / 600, 200 / 600]);
  });

  it("renders as percentages that fill the table", () => {
    const html = documentSchema.nodes.table!.spec.toDOM!(table([[cell("a", { colwidth: [100] }), cell("b", { colwidth: [300] })]]));
    expect(JSON.stringify(html)).toContain('["col",{"style":"width: 25%"}],["col",{"style":"width: 75%"}]');
  });
});

describe("tableStyle", () => {
  it("sets the border colour and width for the cells", () => {
    expect(tableStyle(table([[cell("a")]]))).toBe("");
    expect(tableStyle(table([[cell("a")]], { borderColor: "#cc0000", borderWidth: 2 }))).toBe(
      "--table-border-color: #cc0000; --table-border-width: 2pt",
    );
  });
});

describe("imageSizeStyle", () => {
  it("keeps a stretched image's proportions when it is narrowed", () => {
    expect(imageSizeStyle(null, null)).toBeNull();
    expect(imageSizeStyle(300, null)).toBe("width: 300px");
    expect(imageSizeStyle(300, 100)).toBe("width: 300px; aspect-ratio: 300 / 100");
  });
});

describe("commentQuote", () => {
  it("quotes images as the word Image", () => {
    const doc = Node.fromJSON(documentSchema, {
      type: "doc",
      content: [{ type: "image", attrs: { src: "/uploads/a.png" } }, { type: "paragraph", content: [text("Caption")] }],
    });
    expect(commentQuote(doc, 0, 1)).toBe("Image");
    expect(commentQuote(doc, 0, doc.content.size)).toBe("Image Caption");
  });
});
