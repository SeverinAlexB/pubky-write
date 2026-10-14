import { Node } from "@tiptap/pm/model";
import { Step, Transform } from "@tiptap/pm/transform";
import { describe, expect, it } from "vitest";
import { toMarkdown } from "./markdown.ts";
import { documentSchema } from "./schema.ts";
import {
  acceptedDocument,
  acceptedTextBetween,
  acceptedTextOffsets,
  applySuggestions,
  collectSuggestions,
  describeSuggestion,
  descriptionText,
  hasSuggestions,
  quoteText,
  stripSuggestions,
} from "./suggestions.ts";

const meta = (id: string) => ({ id, author: "You", createdAt: 1_700_000_000_000 });
const text = (value: string, marks: unknown[] = []) => ({ type: "text", text: value, ...(marks.length > 0 && { marks }) });
const insert = (id: string) => ({ type: "suggestionInsert", attrs: meta(id) });
const remove = (id: string) => ({ type: "suggestionDelete", attrs: meta(id) });

/** "Hello [brave ]new [old ]world", one Replace suggestion, and a bold format suggestion on "world". */
const sample = () =>
  Node.fromJSON(documentSchema, {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          text("Hello "),
          text("brave ", [insert("a")]),
          text("new "),
          text("old ", [remove("b")]),
          text("world", [{ type: "bold" }, { type: "suggestionFormat", attrs: { ...meta("c"), before: [] } }]),
        ],
      },
      {
        type: "paragraph",
        attrs: { suggestionBreak: { kind: "insert", ...meta("d") } },
        content: [text("Split off", [insert("d")])],
      },
      {
        type: "heading",
        attrs: {
          level: 2,
          suggestionFormat: { ...meta("e"), before: { type: "paragraph", attrs: { textAlign: null }, list: null } },
        },
        content: [text("Was a paragraph")],
      },
    ],
  });

describe("suggestions in the schema", () => {
  it("loads documents saved before suggestions existed", () => {
    const old = Node.fromJSON(documentSchema, {
      type: "doc",
      content: [{ type: "paragraph", attrs: { textAlign: "center", indent: 1 }, content: [text("Old")] }],
    });
    expect(old.child(0).attrs.suggestionFormat).toBeNull();
    expect(old.child(0).attrs.suggestionBreak).toBeNull();
    expect(hasSuggestions(old)).toBe(false);
  });

  it("round-trips suggestions through JSON", () => {
    const doc = sample();
    expect(() => doc.check()).not.toThrow();
    expect(Node.fromJSON(documentSchema, JSON.parse(JSON.stringify(doc.toJSON()))).eq(doc)).toBe(true);
  });

  it("rejects steps with malformed suggestion attributes, as the server validates them", () => {
    const doc = Node.fromJSON(documentSchema, { type: "doc", content: [{ type: "paragraph", content: [text("Hi")] }] });
    const bad = [
      { stepType: "addMark", from: 1, to: 3, mark: { type: "suggestionInsert", attrs: { id: "", author: "You", createdAt: 1 } } },
      { stepType: "addMark", from: 1, to: 3, mark: { type: "suggestionDelete", attrs: { id: "x", author: "You", createdAt: "now" } } },
      { stepType: "addMark", from: 1, to: 3, mark: { type: "suggestionFormat", attrs: { ...meta("x"), before: "bold" } } },
      { stepType: "attr", pos: 0, attr: "suggestionBreak", value: { kind: "split", ...meta("x") } },
      { stepType: "attr", pos: 0, attr: "suggestionFormat", value: { ...meta("x"), before: { type: "table", attrs: {}, list: null } } },
    ];
    for (const json of bad) {
      expect(() => {
        const result = Step.fromJSON(documentSchema, json).apply(doc);
        if (result.failed) throw new Error(result.failed);
        result.doc!.check();
      }, JSON.stringify(json)).toThrow();
    }
    const good = Step.fromJSON(documentSchema, {
      stepType: "addMark",
      from: 1,
      to: 3,
      mark: { type: "suggestionInsert", attrs: meta("x") },
    }).apply(doc);
    expect(good.failed).toBeNull();
  });
});

describe("structural suggestion attributes in the schema", () => {
  const image = { type: "image", attrs: { src: "/uploads/a.png" } };
  const table = { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph" }] }] }] };

  it("loads objects saved before them with no suggestions", () => {
    const old = Node.fromJSON(documentSchema, { type: "doc", content: [image, table, { type: "pageBreak" }, { type: "horizontalRule" }] });
    old.descendants((node) => {
      if (node.isTextblock) return false;
      expect(node.attrs.suggestionInsert ?? null).toBeNull();
      expect(node.attrs.suggestionDelete ?? null).toBeNull();
      return true;
    });
    expect(old.child(0).attrs.suggestionFormat).toBeNull();
    expect(hasSuggestions(old)).toBe(false);
  });

  it("round-trips them through JSON and HTML attributes", () => {
    const doc = Node.fromJSON(documentSchema, {
      type: "doc",
      content: [
        { ...image, attrs: { ...image.attrs, suggestionInsert: meta("i"), suggestionFormat: { ...meta("f"), before: { width: 10, crop: null } } } },
        { type: "pageBreak", attrs: { suggestionDelete: meta("p") } },
      ],
    });
    expect(Node.fromJSON(documentSchema, JSON.parse(JSON.stringify(doc.toJSON()))).eq(doc)).toBe(true);
    expect(hasSuggestions(doc)).toBe(true);
  });

  it("rejects malformed values in steps, as the server validates them", () => {
    const doc = Node.fromJSON(documentSchema, { type: "doc", content: [image, { type: "paragraph" }] });
    const bad = [
      { stepType: "attr", pos: 0, attr: "suggestionInsert", value: { id: "", author: "You", createdAt: 1 } },
      { stepType: "attr", pos: 0, attr: "suggestionDelete", value: "yes" },
      { stepType: "attr", pos: 0, attr: "suggestionFormat", value: { ...meta("x"), before: { onclick: "x" } } },
      { stepType: "attr", pos: 0, attr: "suggestionFormat", value: { ...meta("x"), before: { width: [1] } } },
    ];
    for (const json of bad) {
      expect(() => {
        const result = Step.fromJSON(documentSchema, json).apply(doc);
        if (result.failed) throw new Error(result.failed);
        result.doc!.check();
      }, JSON.stringify(json)).toThrow();
    }
    const good = Step.fromJSON(documentSchema, { stepType: "attr", pos: 0, attr: "suggestionInsert", value: meta("x") }).apply(doc);
    expect(good.failed).toBeNull();
    expect(() => good.doc!.check()).not.toThrow();
  });

  it("strips them from pasted content and leaves deleted objects out of the accepted result", () => {
    const doc = Node.fromJSON(documentSchema, {
      type: "doc",
      content: [
        { ...image, attrs: { ...image.attrs, suggestionDelete: meta("d") } },
        { type: "paragraph", content: [text("Kept")] },
      ],
    });
    expect(hasSuggestions(documentSchema.topNodeType.create(null, stripSuggestions(doc.slice(0, doc.content.size)).content))).toBe(false);
    const accepted = acceptedDocument(doc);
    expect(accepted.childCount).toBe(1);
    expect(toMarkdown(doc)).toBe("Kept\n");
  });
});

describe("collectSuggestions and describeSuggestion", () => {
  it("lists every suggestion in document order with its description", () => {
    const suggestions = collectSuggestions(sample());
    expect(suggestions.map((suggestion) => suggestion.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(suggestions.map((suggestion) => describeSuggestion(suggestion).map(descriptionText).join(" / "))).toEqual([
      "Add: “brave”",
      "Delete: “old”",
      "Format: bold",
      "Add: “Split off”",
      "Format: paragraph style",
    ]);
  });

  it("describes a deletion followed by an insertion as a Replace", () => {
    const doc = Node.fromJSON(documentSchema, {
      type: "doc",
      content: [{ type: "paragraph", content: [text("cat", [remove("r")]), text("dog", [insert("r")])] }],
    });
    expect(describeSuggestion(collectSuggestions(doc)[0]!).map(descriptionText)).toEqual(["Replace: “cat” with “dog”"]);
  });

  it("truncates long quotes to about 50 characters", () => {
    const quoted = quoteText("a".repeat(80));
    expect(quoted).toBe(`${"a".repeat(50)}…`);
    expect(quoteText("  spaced   out ")).toBe("spaced out");
  });
});

describe("applySuggestions", () => {
  it("accepts everything", () => {
    const accepted = applySuggestions(new Transform(sample()), "accept").doc;
    expect(accepted.textBetween(0, accepted.content.size, "|")).toBe("Hello brave new world|Split off|Was a paragraph");
    expect(accepted.child(2).type.name).toBe("heading");
    expect(hasSuggestions(accepted)).toBe(false);
    expect(accepted.rangeHasMark(1, accepted.child(0).nodeSize, documentSchema.marks.bold!)).toBe(true);
  });

  it("rejects everything", () => {
    const rejected = applySuggestions(new Transform(sample()), "reject").doc;
    expect(rejected.textBetween(0, rejected.content.size, "|")).toBe("Hello new old world|Was a paragraph");
    expect(rejected.child(1).type.name).toBe("paragraph");
    expect(rejected.rangeHasMark(0, rejected.content.size, documentSchema.marks.bold!)).toBe(false);
    expect(hasSuggestions(rejected)).toBe(false);
  });

  it("accepts or rejects only the given suggestions", () => {
    const doc = applySuggestions(new Transform(sample()), "reject", new Set(["a", "d"])).doc;
    expect(doc.textBetween(0, doc.content.size, "|")).toBe("Hello new old world|Was a paragraph");
    expect(collectSuggestions(doc).map((suggestion) => suggestion.id)).toEqual(["b", "c", "e"]);
  });

  it("does not join a suggested break across a table", () => {
    const doc = Node.fromJSON(documentSchema, {
      type: "doc",
      content: [
        { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [text("Cell")] }] }] }] },
        { type: "paragraph", attrs: { suggestionBreak: { kind: "delete", ...meta("x") } }, content: [text("After")] },
      ],
    });
    const accepted = applySuggestions(new Transform(doc), "accept").doc;
    expect(accepted.childCount).toBe(2);
    expect(accepted.child(1).attrs.suggestionBreak).toBeNull();
  });
});

describe("the accepted result", () => {
  it("is what Markdown exports", () => {
    expect(toMarkdown(sample())).toBe("Hello brave new **world**\n\nSplit off\n\n## Was a paragraph\n");
  });

  it("leaves deleted text out of the text that word count and the outline read", () => {
    const doc = sample();
    expect(acceptedTextBetween(doc, 0, doc.content.size, "\n")).toBe("Hello brave new world\nSplit off\nWas a paragraph");
    expect(acceptedDocument(doc).textContent).toBe("Hello brave new worldSplit offWas a paragraph");
  });

  it("maps text without deletions back to document offsets for search", () => {
    const { text: visible, offsets } = acceptedTextOffsets(sample().child(0), () => "￼");
    expect(visible).toBe("Hello brave new world");
    // "world" starts after the 4 characters of the deleted "old ".
    expect(offsets![visible.indexOf("world")]).toBe("Hello brave new old ".length);
  });
});

describe("stripSuggestions", () => {
  it("removes suggestion marks and attributes from pasted content", () => {
    const slice = sample().slice(0, sample().content.size);
    const stripped = stripSuggestions(slice);
    const doc = documentSchema.topNodeType.create(null, stripped.content);
    expect(hasSuggestions(doc)).toBe(false);
    expect(doc.textContent).toBe(sample().textContent);
  });
});
