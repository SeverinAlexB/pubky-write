import { applySuggestions, collectSuggestions, describeSuggestion, descriptionText, documentSchema, hasSuggestions } from "@docs/shared";
import { Node } from "@tiptap/pm/model";
import { EditorState, NodeSelection, TextSelection, type Selection, type Transaction } from "@tiptap/pm/state";
import { addColumnAfter, addRowAfter, CellSelection, deleteColumn, deleteRow, mergeCells } from "@tiptap/pm/tables";
import { Transform } from "@tiptap/pm/transform";
import { describe, expect, it } from "vitest";
import { applyDirectly, resolveSuggestions, suggestTransaction, type SuggestContext } from "./suggesting.ts";

const text = (value: string) => ({ type: "text", text: value });
const paragraph = (value = "") => ({ type: "paragraph", ...(value && { content: [text(value)] }) });
const cell = (value = "") => ({ type: "tableCell", content: [paragraph(value)] });
const row = (...values: string[]) => ({ type: "tableRow", content: values.map((value) => cell(value)) });
const image = (attrs: Record<string, unknown> = {}) => ({ type: "image", attrs: { src: "/uploads/a.png", ...attrs } });

function makeDoc(...content: unknown[]): Node {
  return Node.fromJSON(documentSchema, { type: "doc", content });
}

/** Applies transactions in Suggesting mode, as the editor's dispatch hook does. */
class Session {
  state: EditorState;
  context: SuggestContext = { author: "You", now: 1_000_000, group: null };
  made: string | null = null;

  constructor(doc: Node, cursor = 1) {
    this.state = EditorState.create({ doc, selection: TextSelection.near(doc.resolve(cursor)) });
  }

  edit(build: (state: EditorState) => Transaction | null | undefined): Transaction | null {
    const original = build(this.state);
    if (!original) return null;
    const result = suggestTransaction(this.state, original, this.context);
    const applied = result?.tr ?? original;
    if (result) this.context = { ...this.context, group: result.group };
    this.made = result?.made ?? null;
    this.state = this.state.apply(applied);
    return applied;
  }

  /** Runs a ProseMirror command through the rewriting. */
  command(command: (state: EditorState, dispatch: (tr: Transaction) => void) => boolean): void {
    let tr: Transaction | null = null;
    command(this.state, (result) => (tr = result));
    expect(tr, "the command applies").not.toBeNull();
    this.edit(() => tr);
  }

  select(selection: (doc: Node) => Selection): void {
    this.state = this.state.apply(this.state.tr.setSelection(selection(this.state.doc)));
  }

  type(value: string): void {
    for (const character of value) this.edit((state) => state.tr.insertText(character));
  }

  descriptions(): string[] {
    return collectSuggestions(this.state.doc).map((suggestion) => describeSuggestion(suggestion).map(descriptionText).join(" / "));
  }

  resolve(action: "accept" | "reject", ids: string[] | null = null): void {
    const tr = resolveSuggestions(this.state, action, ids);
    if (tr) this.state = this.state.apply(tr);
  }

  get doc(): Node {
    return this.state.doc;
  }
}

/** Every node of a type, in document order. */
function nodesOf(doc: Node, type: string): Node[] {
  const found: Node[] = [];
  doc.descendants((node) => {
    if (node.type.name === type) found.push(node);
    return true;
  });
  return found;
}

const insertNode = (json: unknown) => (state: EditorState) => state.tr.replaceSelectionWith(Node.fromJSON(documentSchema, json));

describe("structural suggestions: images", () => {
  it("suggests an inserted image, outlined as an insertion; rejecting removes it and joins the paragraph", () => {
    const session = new Session(makeDoc(paragraph("Hello world")), 6);
    session.edit(insertNode(image()));
    const [inserted] = nodesOf(session.doc, "image");
    expect(inserted?.attrs.suggestionInsert).toMatchObject({ author: "You" });
    expect(session.descriptions()).toEqual(["Add: Image"]);
    expect(session.made).toBe(inserted!.attrs.suggestionInsert.id);
    session.resolve("reject");
    expect(nodesOf(session.doc, "image")).toHaveLength(0);
    expect(session.doc.textBetween(0, session.doc.content.size, "|")).toBe("Hello world");
    expect(hasSuggestions(session.doc)).toBe(false);
  });

  it("accepting an inserted image keeps it as a normal image", () => {
    const session = new Session(makeDoc(paragraph("Hello"), paragraph()), 8);
    session.edit(insertNode(image()));
    session.resolve("accept");
    const [kept] = nodesOf(session.doc, "image");
    expect(kept?.attrs.suggestionInsert).toBeNull();
    expect(hasSuggestions(session.doc)).toBe(false);
  });

  it("keeps a deleted image with a deletion suggestion; accepting removes it, rejecting keeps it", () => {
    const doc = makeDoc(paragraph("Before"), image(), paragraph("After"));
    for (const action of ["accept", "reject"] as const) {
      const session = new Session(doc);
      session.select((current) => NodeSelection.create(current, 8));
      session.edit((state) => state.tr.deleteSelection());
      expect(nodesOf(session.doc, "image")[0]?.attrs.suggestionDelete).toMatchObject({ author: "You" });
      expect(session.descriptions()).toEqual(["Delete: Image"]);
      session.resolve(action);
      expect(nodesOf(session.doc, "image")).toHaveLength(action === "accept" ? 0 : 1);
      expect(hasSuggestions(session.doc)).toBe(false);
    }
  });

  it("deletes an image that is a pending insertion directly", () => {
    const session = new Session(makeDoc(paragraph("Hello"), paragraph()), 8);
    session.edit(insertNode(image()));
    const pos = nodePos(session.doc, "image");
    session.select((current) => NodeSelection.create(current, pos));
    session.edit((state) => state.tr.deleteSelection());
    expect(nodesOf(session.doc, "image")).toHaveLength(0);
  });

  it("records size, wrap and rotation changes as one Format: image suggestion; rejecting restores them", () => {
    const session = new Session(makeDoc(paragraph("Text"), image({ width: 200, height: 100 }), paragraph()));
    const pos = nodePos(session.doc, "image");
    const change = (attrs: Record<string, unknown>) =>
      session.edit((state) => state.tr.setNodeMarkup(pos, undefined, { ...state.doc.nodeAt(pos)!.attrs, ...attrs }));
    change({ width: 300, height: 150 });
    change({ wrap: "wrap" });
    change({ rotation: 90, crop: { top: 0.1, right: 0, bottom: 0, left: 0 } });
    expect(session.descriptions()).toEqual(["Format: image"]);
    const changed = session.doc.nodeAt(pos)!;
    expect(changed.attrs).toMatchObject({ width: 300, wrap: "wrap", rotation: 90 });
    session.resolve("reject");
    expect(session.doc.nodeAt(pos)!.attrs).toMatchObject({ width: 200, height: 100, wrap: "inline", rotation: 0, crop: null, suggestionFormat: null });
  });

  it("drops the format suggestion when an image is changed back", () => {
    const session = new Session(makeDoc(paragraph("Text"), image({ width: 200, height: 100 }), paragraph()));
    const pos = nodePos(session.doc, "image");
    const change = (attrs: Record<string, unknown>) =>
      session.edit((state) => state.tr.setNodeMarkup(pos, undefined, { ...state.doc.nodeAt(pos)!.attrs, ...attrs }));
    change({ rotation: 45 });
    change({ rotation: 0 });
    expect(hasSuggestions(session.doc)).toBe(false);
  });

  it("moves a dragged image directly", () => {
    const session = new Session(makeDoc(image({ wrap: "wrap" }), paragraph("One"), paragraph("Two")));
    const result = suggestTransaction(
      session.state,
      (() => {
        const tr = session.state.tr;
        const node = tr.doc.nodeAt(0)!;
        tr.delete(0, 1);
        tr.insert(tr.mapping.map(6, -1), node);
        return tr;
      })(),
      session.context,
    );
    expect(result).toBeNull();
  });
});

describe("structural suggestions: tables", () => {
  const table = () => makeDoc({ type: "table", content: [row("a1", "b1"), row("a2", "b2")] }, paragraph());

  it("suggests an inserted row; rejecting removes it", () => {
    const session = new Session(table(), 4);
    session.command(addRowAfter);
    const rows = nodesOf(session.doc, "tableRow");
    expect(rows).toHaveLength(3);
    expect(rows[1]!.attrs.suggestionInsert).toMatchObject({ author: "You" });
    expect(session.descriptions()).toEqual(["Add: Table row"]);
    session.resolve("reject");
    expect(nodesOf(session.doc, "tableRow")).toHaveLength(2);
  });

  it("strikes a deleted row through; accepting removes it", () => {
    const session = new Session(table(), 4);
    session.command(deleteRow);
    const rows = nodesOf(session.doc, "tableRow");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.attrs.suggestionDelete).toMatchObject({ author: "You" });
    expect(session.descriptions()).toEqual(["Delete: Table row"]);
    session.resolve("accept");
    expect(nodesOf(session.doc, "tableRow")).toHaveLength(1);
    expect(session.doc.textBetween(0, session.doc.content.size, "|")).toBe("a2|b2|");
  });

  it("suggests an inserted column as one suggestion over its cells", () => {
    const session = new Session(table(), 4);
    session.command(addColumnAfter);
    expect(nodesOf(session.doc, "tableCell").filter((node) => node.attrs.suggestionInsert)).toHaveLength(2);
    expect(session.descriptions()).toEqual(["Add: Table column"]);
    session.resolve("accept");
    expect(nodesOf(session.doc, "tableCell")).toHaveLength(6);
    expect(hasSuggestions(session.doc)).toBe(false);
  });

  it("suggests a deleted column; accepting removes its cells", () => {
    const session = new Session(table(), 4);
    session.command(deleteColumn);
    expect(session.descriptions()).toEqual(["Delete: Table column"]);
    session.resolve("accept");
    expect(session.doc.textBetween(0, session.doc.content.size, "|")).toBe("b1|b2|");
  });

  it("removes the whole table when every row is deleted and accepted", () => {
    const session = new Session(table(), 4);
    session.command(deleteRow);
    session.select((doc) => TextSelection.near(doc.resolve(nodePosAfter(doc, "tableRow", 1) + 3)));
    session.command(deleteRow);
    session.resolve("accept");
    expect(nodesOf(session.doc, "table")).toHaveLength(0);
  });

  it("merges cells directly", () => {
    const session = new Session(table(), 4);
    session.select((doc) => CellSelection.create(doc, 2, nodePosAfter(doc, "tableCell", 1)));
    session.command(mergeCells);
    expect(hasSuggestions(session.doc)).toBe(false);
    expect(nodesOf(session.doc, "tableCell")[0]!.attrs.colspan).toBe(2);
  });

  it("suggests an inserted table; text typed in it belongs to the insertion", () => {
    const session = new Session(makeDoc(paragraph("Intro"), paragraph()), 8);
    session.edit(insertNode({ type: "table", content: [row("", "")] }));
    const tablePos = nodePos(session.doc, "table");
    session.select((doc) => TextSelection.create(doc, tablePos + 4));
    session.type("x");
    expect(session.descriptions()).toEqual(["Add: Table"]);
    session.resolve("reject");
    expect(nodesOf(session.doc, "table")).toHaveLength(0);
    expect(hasSuggestions(session.doc)).toBe(false);
  });

  it("deletes a row of a pending table directly", () => {
    const session = new Session(makeDoc(paragraph("Intro"), paragraph()), 8);
    session.edit(insertNode({ type: "table", content: [row("", ""), row("", "")] }));
    session.select((doc) => TextSelection.create(doc, nodePos(doc, "table") + 4));
    session.command(deleteRow);
    expect(nodesOf(session.doc, "tableRow")).toHaveLength(1);
    expect(session.descriptions()).toEqual(["Add: Table"]);
  });
});

describe("structural suggestions: breaks, lines, tables of contents and footnotes", () => {
  for (const [type, label] of [
    ["pageBreak", "Page break"],
    ["columnBreak", "Column break"],
    ["horizontalRule", "Horizontal line"],
  ] as const) {
    it(`suggests an inserted and a deleted ${label}`, () => {
      const session = new Session(makeDoc(paragraph("One"), paragraph("Two")), 5);
      session.edit((state) => state.tr.insert(5, documentSchema.nodes[type]!.create()));
      expect(session.descriptions()).toEqual([`Add: ${label}`]);
      session.resolve("accept");
      session.select((doc) => NodeSelection.create(doc, 5));
      session.edit((state) => state.tr.deleteSelection());
      expect(session.descriptions()).toEqual([`Delete: ${label}`]);
      session.resolve("accept");
      expect(nodesOf(session.doc, type)).toHaveLength(0);
    });
  }

  it("suggests an inserted table of contents", () => {
    const session = new Session(makeDoc(paragraph("One"), { type: "heading", attrs: { level: 1 }, content: [text("Head")] }), 5);
    session.edit((state) =>
      state.tr.insert(5, Node.fromJSON(documentSchema, { type: "tableOfContents", content: [{ type: "tocEntry", content: [text("Head")] }] })),
    );
    expect(session.descriptions()).toEqual(["Add: Table of contents"]);
    session.resolve("reject");
    expect(nodesOf(session.doc, "tableOfContents")).toHaveLength(0);
  });

  it("suggests an inserted and a deleted footnote", () => {
    const session = new Session(makeDoc(paragraph("Note")), 5);
    session.edit((state) => state.tr.insert(5, documentSchema.nodes.footnote!.create()));
    expect(session.descriptions()).toEqual(["Add: Footnote"]);
    session.resolve("accept");
    session.select((doc) => NodeSelection.create(doc, 5));
    session.edit((state) => state.tr.deleteSelection());
    expect(session.descriptions()).toEqual(["Delete: Footnote"]);
    session.resolve("reject");
    expect(nodesOf(session.doc, "footnote")).toHaveLength(1);
    expect(hasSuggestions(session.doc)).toBe(false);
  });

  it("applies transactions marked as direct", () => {
    const session = new Session(makeDoc(paragraph("One")), 5);
    session.edit((state) => applyDirectly(state.tr.insert(5, documentSchema.nodes.pageBreak!.create())));
    expect(hasSuggestions(session.doc)).toBe(false);
  });
});

describe("suggestions in headers, footers and footnotes", () => {
  const meta = (id: string) => ({ id, author: "You", createdAt: 1 });
  const withRegions = () =>
    Node.fromJSON(documentSchema, {
      type: "doc",
      attrs: {
        header: [{ type: "paragraph", content: [{ type: "text", text: "Draft", marks: [{ type: "suggestionInsert", attrs: meta("h") }] }] }],
        footer: [{ type: "paragraph", content: [{ type: "text", text: "Old footer", marks: [{ type: "suggestionDelete", attrs: meta("f") }] }] }],
      },
      content: [
        {
          type: "paragraph",
          content: [
            text("Body"),
            {
              type: "footnote",
              attrs: { content: [{ type: "paragraph", content: [{ type: "text", text: "added", marks: [{ type: "suggestionInsert", attrs: meta("n") }] }] }] },
            },
          ],
        },
      ],
    });

  it("lists them with the region they are in", () => {
    const suggestions = collectSuggestions(withRegions());
    expect(suggestions.map((suggestion) => [suggestion.id, suggestion.region?.key, suggestion.from])).toEqual([
      ["h", "header", 0],
      ["n", "footnote", 5],
      ["f", "footer", withRegions().content.size],
    ]);
    expect(describeSuggestion(suggestions[0]!).map(descriptionText)).toEqual(["Add: “Draft”"]);
    expect(suggestions[0]!.region).toMatchObject({ from: 1, to: 6 });
  });

  it("accepts and rejects them in the region's content", () => {
    const accepted = applySuggestions(new Transform(withRegions()), "accept").doc;
    expect(hasSuggestions(accepted)).toBe(false);
    expect(regionText(accepted.attrs.header)).toBe("Draft");
    expect(regionText(accepted.attrs.footer)).toBe("");
    const rejected = applySuggestions(new Transform(withRegions()), "reject", new Set(["h", "n"])).doc;
    expect(regionText(rejected.attrs.header)).toBe("");
    expect(regionText(rejected.child(0).child(1).attrs.content)).toBe("");
    expect(collectSuggestions(rejected).map((suggestion) => suggestion.id)).toEqual(["f"]);
  });
});

function regionText(content: unknown): string {
  return Node.fromJSON(documentSchema, { type: "doc", content }).textContent;
}

function nodePos(doc: Node, type: string): number {
  return nodePosAfter(doc, type, 0);
}

/** The position of the `index`-th node of a type. */
function nodePosAfter(doc: Node, type: string, index: number): number {
  let found = -1;
  let count = 0;
  doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.type.name === type && count++ === index) found = pos;
    return true;
  });
  return found;
}
