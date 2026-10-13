import { Node } from "@tiptap/pm/model";
import { Step } from "@tiptap/pm/transform";
import { describe, expect, it } from "vitest";
import { paragraphSpace } from "./paragraphFormat.ts";
import { paragraphStyleOf } from "./paragraphStyles.ts";
import { documentSchema } from "./schema.ts";

const text = (value: string) => ({ type: "text", text: value });

/** A document as stored before Title, Subtitle, Heading 4–6, spacing, list presets and checklists existed. */
const oldDocument = {
  type: "doc",
  content: [
    { type: "heading", attrs: { textAlign: null, lineSpacing: null, indent: 0, level: 1 }, content: [text("Heading")] },
    {
      type: "paragraph",
      attrs: { textAlign: "center", lineSpacing: 1.5, indent: 2 },
      content: [{ type: "text", text: "Body", marks: [{ type: "bold" }, { type: "strike" }] }],
    },
    { type: "heading", attrs: { level: 3 }, content: [text("Small heading")] },
    {
      type: "bulletList",
      content: [{ type: "listItem", content: [{ type: "paragraph", content: [text("Item")] }] }],
    },
    { type: "orderedList", attrs: { start: 1 }, content: [{ type: "listItem", content: [{ type: "paragraph" }] }] },
    { type: "horizontalRule" },
  ],
};

describe("document schema", () => {
  it("loads documents saved in the old format", () => {
    const doc = Node.fromJSON(documentSchema, oldDocument);
    expect(() => doc.check()).not.toThrow();

    const [heading, paragraph, smallHeading, bulletList] = [0, 1, 2, 3].map((index) => doc.child(index));
    expect(paragraphStyleOf(heading!)).toBe("h1");
    expect(paragraphStyleOf(paragraph!)).toBe("normal");
    expect(paragraphStyleOf(smallHeading!)).toBe("h3");
    expect(paragraph!.attrs).toMatchObject({ textAlign: "center", lineSpacing: 1.5, indent: 2, paragraphStyle: null });
    // Old paragraphs get the spacing of their style.
    expect(paragraphSpace(heading!, "spaceBefore")).toBe(20);
    expect(paragraphSpace(paragraph!, "spaceAfter")).toBe(0);
    expect(bulletList!.attrs.listPreset).toBe(0);
  });

  it("applies steps stored in the old format", () => {
    const doc = Node.fromJSON(documentSchema, oldDocument);
    const steps = [
      { stepType: "replace", from: 1, to: 1, slice: { content: [text("New ")] } },
      { stepType: "attr", pos: 13, attr: "textAlign", value: "right" },
      {
        stepType: "replaceAround",
        from: 13,
        to: 19,
        gapFrom: 14,
        gapTo: 18,
        insert: 1,
        slice: { content: [{ type: "heading", attrs: { level: 2 } }] },
        structure: true,
      },
    ];
    let result = doc;
    for (const json of steps) {
      const applied = Step.fromJSON(documentSchema, json).apply(result);
      expect(applied.failed).toBeNull();
      result = applied.doc!;
    }
    expect(result.child(0).textContent).toBe("New Heading");
    expect(result.child(1).type.name).toBe("heading");
    expect(result.child(1).attrs.level).toBe(2);
    expect(() => result.check()).not.toThrow();
  });

  it("round-trips every new kind of content", () => {
    const json = {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { paragraphStyle: "title" }, content: [text("Title")] },
        { type: "paragraph", attrs: { paragraphStyle: "subtitle", spaceAfter: 30 }, content: [text("Subtitle")] },
        { type: "heading", attrs: { level: 6, spaceBefore: 0 }, content: [text("H6")] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "2", marks: [{ type: "superscript" }] },
            { type: "text", text: "2", marks: [{ type: "subscript" }] },
          ],
        },
        { type: "pageBreak" },
        {
          type: "bulletList",
          attrs: { listPreset: 3 },
          content: [{ type: "listItem", content: [{ type: "paragraph", content: [text("Star")] }] }],
        },
        {
          type: "taskList",
          attrs: { listPreset: 1 },
          content: [
            { type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [text("Done")] }] },
            { type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [text("To do")] }] },
          ],
        },
      ],
    };
    const doc = Node.fromJSON(documentSchema, json);
    expect(() => doc.check()).not.toThrow();
    const reloaded = Node.fromJSON(documentSchema, JSON.parse(JSON.stringify(doc.toJSON())));
    expect(reloaded.eq(doc)).toBe(true);

    expect(paragraphStyleOf(doc.child(0))).toBe("title");
    expect(paragraphSpace(doc.child(1), "spaceAfter")).toBe(30);
    expect(paragraphSpace(doc.child(1), "spaceBefore")).toBe(0);
    expect(paragraphSpace(doc.child(2), "spaceBefore")).toBe(0);
    expect(paragraphSpace(doc.child(2), "spaceAfter")).toBe(4);
  });

  it("does not allow superscript and subscript on the same text", () => {
    const superscript = documentSchema.marks.superscript!.create();
    const subscript = documentSchema.marks.subscript!.create();
    expect(subscript.addToSet([superscript])).toEqual([subscript]);
  });
});
