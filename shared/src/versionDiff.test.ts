import { Node } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";
import { documentSchema, emptyDocument } from "./schema.ts";
import { replaceDifference, versionEdits } from "./versionDiff.ts";

const paragraphs = (...texts: string[]) =>
  Node.fromJSON(documentSchema, {
    type: "doc",
    content: texts.map((text) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] })),
  });

/** The added text and the removed text of each edit. */
function describeEdits(before: Node, after: Node) {
  return versionEdits(before, after).map((edit) => ({
    added: after.textBetween(edit.from, edit.to, "|"),
    deleted: edit.deleted,
  }));
}

describe("replaceDifference", () => {
  it.each([
    [["aaa"], ["aa"]],
    [["abc", "def"], ["abc"]],
    [["abc"], ["abc", "", "xyz"]],
    [["one", "two"], ["one", "TWO", "three"]],
    [["same"], ["same"]],
  ])("turns %j into %j", (from, to) => {
    const target = paragraphs(...to);
    expect(replaceDifference(paragraphs(...from), target).doc.eq(target)).toBe(true);
  });
});

describe("versionEdits", () => {
  it("finds no edits between equal documents", () => {
    expect(versionEdits(paragraphs("same", "text"), paragraphs("same", "text"))).toEqual([]);
  });

  it("marks text added at the end", () => {
    expect(describeEdits(paragraphs("First draft"), paragraphs("First draft and more"))).toEqual([
      { added: " and more", deleted: "" },
    ]);
  });

  it("finds separate edits in different paragraphs, in document order", () => {
    const before = paragraphs("Alpha beginning", "unchanged middle paragraph here", "Omega end");
    const after = paragraphs("Alpha new beginning", "unchanged middle paragraph here", "Omega end extra");
    expect(describeEdits(before, after)).toEqual([
      { added: "new ", deleted: "" },
      { added: " extra", deleted: "" },
    ]);
  });

  it("reports removed text with an empty range where it was", () => {
    const before = paragraphs("Keep this and remove that sentence entirely");
    const after = paragraphs("Keep this sentence entirely");
    const edits = versionEdits(before, after);
    expect(edits).toHaveLength(1);
    expect(edits[0]!.from).toBe(edits[0]!.to);
    expect(edits[0]!.deleted).toBe("and remove that ");
  });

  it("widens a replacement inside a word to the whole word", () => {
    expect(describeEdits(paragraphs("The colour is red"), paragraphs("The colours is red"))).toEqual([
      { added: "s", deleted: "" },
    ]);
    expect(describeEdits(paragraphs("The cat sat"), paragraphs("The dog sat"))).toEqual([{ added: "dog", deleted: "cat" }]);
  });

  it("counts a new paragraph as one edit", () => {
    expect(describeEdits(paragraphs("One"), paragraphs("One", "Two"))).toEqual([{ added: "Two", deleted: "" }]);
  });

  it("compares the oldest version with an empty document", () => {
    const empty = Node.fromJSON(documentSchema, emptyDocument);
    expect(describeEdits(empty, paragraphs("Hello"))).toEqual([{ added: "Hello", deleted: "" }]);
  });

  it("ignores page setting changes", () => {
    const before = paragraphs("Text");
    const after = replaceDifference(before, before).setDocAttribute("orientation", "landscape").doc;
    expect(versionEdits(before, after)).toEqual([]);
  });
});

describe("versionEdits in long documents", () => {
  const lines = Array.from({ length: 80 }, (_, i) => `Paragraph ${i + 1} with some filler text that is long enough to wrap.`);

  it("finds small edits far apart instead of one replacement of everything between them", () => {
    const changed = [...lines];
    changed[1] = changed[1]!.replace("some ", "");
    changed[78] = `${changed[78]} More.`;
    expect(describeEdits(paragraphs(...lines), paragraphs(...changed))).toEqual([
      { added: "", deleted: "some " },
      { added: " More.", deleted: "" },
    ]);
  });

  it("matches unchanged paragraphs around inserted and removed ones", () => {
    const changed = [...lines.slice(0, 10), "A new paragraph", ...lines.slice(10, 40), ...lines.slice(41)];
    const edits = describeEdits(paragraphs(...lines), paragraphs(...changed));
    expect(edits).toHaveLength(2);
    expect(edits[0]!.added).toContain("A new paragraph");
    expect(edits[1]!.deleted).toContain("Paragraph 41 with");
  });
});

describe("equations in version history", () => {
  const withEquation = (latex: string) =>
    Node.fromJSON(documentSchema, {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "E = " }, { type: "equation", attrs: { latex } }] }],
    });

  it("a changed equation is an edit, an unchanged one is not", () => {
    expect(versionEdits(withEquation("mc^2"), withEquation("mc^3"))).toHaveLength(1);
    expect(versionEdits(withEquation("mc^2"), withEquation("mc^2"))).toHaveLength(0);
  });

  it("restoring a version restores its equation", () => {
    const target = withEquation("mc^2");
    expect(replaceDifference(withEquation("x"), target).doc.eq(target)).toBe(true);
  });
});
