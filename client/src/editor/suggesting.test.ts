import {
  applySuggestions,
  collectSuggestions,
  describeSuggestion,
  descriptionText,
  documentSchema,
  mapAnchor,
} from "@pubky-write/shared";
import { Node } from "@tiptap/pm/model";
import { wrapInList } from "@tiptap/pm/schema-list";
import { EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";
import { AddMarkStep, Transform } from "@tiptap/pm/transform";
import { describe, expect, it } from "vitest";
import { defaultSearchOptions, findMatches } from "./search.ts";
import { GROUP_TIMEOUT_MS, resolveSuggestions, suggestTransaction, type SuggestContext } from "./suggesting.ts";
import { documentStats } from "./textStats.ts";

const text = (value: string, marks?: unknown[]) => ({ type: "text", text: value, ...(marks && { marks }) });
const paragraph = (value = "") => ({ type: "paragraph", ...(value && { content: [text(value)] }) });

function makeDoc(...paragraphs: string[]): Node {
  return Node.fromJSON(documentSchema, { type: "doc", content: paragraphs.map((value) => paragraph(value)) });
}

/** A small editor: applies transactions in Suggesting mode, as the editor's dispatch hook does. */
class Session {
  state: EditorState;
  context: SuggestContext = { author: "You", now: 1_000_000, group: null };
  /** The suggestion the last edit made or extended (the active card). */
  made: string | null = null;

  constructor(doc: Node, cursor = 1) {
    this.state = EditorState.create({ doc, selection: TextSelection.create(doc, cursor) });
  }

  /** Dispatches `build(state)` through the rewriting; returns the transaction that was applied. */
  edit(build: (state: EditorState) => Transaction): Transaction {
    const original = build(this.state);
    const result = suggestTransaction(this.state, original, this.context);
    const applied = result?.tr ?? original;
    if (result) this.context = { ...this.context, group: result.group };
    this.made = result?.made ?? null;
    this.state = this.state.apply(applied);
    return applied;
  }

  type(value: string): void {
    for (const character of value) this.edit((state) => state.tr.insertText(character));
  }

  /** Backspace with a collapsed cursor: deletes the character before it. */
  backspace(): void {
    this.edit((state) => state.tr.delete(state.selection.from - 1, state.selection.from));
  }

  select(from: number, to = from): void {
    this.state = this.state.apply(this.state.tr.setSelection(TextSelection.create(this.state.doc, from, to)));
  }

  later(ms: number): void {
    this.context = { ...this.context, now: this.context.now + ms };
  }

  get text(): string {
    return this.state.doc.textBetween(0, this.state.doc.content.size, "|");
  }

  get suggestions() {
    return collectSuggestions(this.state.doc);
  }

  descriptions(): string[] {
    return this.suggestions.map((suggestion) => describeSuggestion(suggestion).map(descriptionText).join(" / "));
  }

  resolve(action: "accept" | "reject", ids: string[] | null = null): void {
    const tr = resolveSuggestions(this.state, action, ids);
    if (tr) this.state = this.state.apply(tr);
  }
}

/** Text of the inline nodes carrying a mark, in document order. */
function markedText(doc: Node, markName: string): string {
  let result = "";
  doc.descendants((node) => {
    if (node.isText && node.marks.some((mark) => mark.type.name === markName)) result += node.text;
    return true;
  });
  return result;
}

describe("suggesting: typing and deleting", () => {
  it("marks typed text as one insertion and keeps the cursor after it", () => {
    const session = new Session(makeDoc("First item"), 11);
    session.type(" suggested");
    expect(session.text).toBe("First item suggested");
    expect(markedText(session.state.doc, "suggestionInsert")).toBe(" suggested");
    expect(session.suggestions).toHaveLength(1);
    expect(session.descriptions()).toEqual(["Add: “suggested”"]);
    expect(session.state.selection.from).toBe(21);
  });

  it("keeps deleted text, struck through, and moves the cursor before it on Backspace", () => {
    const session = new Session(makeDoc("Second item"), 12);
    for (let i = 0; i < "Second item".length; i++) session.backspace();
    expect(session.text).toBe("Second item");
    expect(markedText(session.state.doc, "suggestionDelete")).toBe("Second item");
    expect(session.state.selection.from).toBe(1);
    expect(session.descriptions()).toEqual(["Delete: “Second item”"]);
  });

  it("deletes a selection as a suggestion that only uses AddMarkSteps, so comment anchors stay", () => {
    const session = new Session(makeDoc("The quick brown fox"));
    session.select(11, 16);
    const applied = session.edit((state) => state.tr.deleteSelection());
    expect(applied.steps.every((step) => step instanceof AddMarkStep)).toBe(true);
    expect(mapAnchor(applied.mapping, { from: 11, to: 16 })).toEqual({ from: 11, to: 16 });
    expect(session.descriptions()).toEqual(["Delete: “brown”"]);
    // The cursor is after the deleted text.
    expect(session.state.selection.from).toBe(16);
  });

  it("removes a pending insertion by the same author directly", () => {
    const session = new Session(makeDoc("Hello"), 6);
    session.type("abc");
    session.backspace();
    session.backspace();
    expect(session.text).toBe("Helloa");
    expect(markedText(session.state.doc, "suggestionInsert")).toBe("a");
    session.backspace();
    expect(session.text).toBe("Hello");
    expect(session.suggestions).toHaveLength(0);
  });

  it("turns typing over a selection into one Replace suggestion", () => {
    const session = new Session(makeDoc("Hello world"));
    session.select(7, 12);
    session.edit((state) => state.tr.insertText("t"));
    session.type("here");
    expect(session.text).toBe("Hello worldthere");
    expect(session.descriptions()).toEqual(["Replace: “world” with “there”"]);
  });

  it("extends a pending insertion when typing inside it", () => {
    const session = new Session(makeDoc("Hi"), 3);
    session.type(" there");
    const [first] = session.suggestions;
    session.later(GROUP_TIMEOUT_MS + 1);
    session.select(5);
    session.type("X");
    expect(session.text).toBe("Hi tXhere");
    expect(session.suggestions.map((suggestion) => suggestion.id)).toEqual([first!.id]);
  });

  it("starts a new suggestion after the cursor moves away or after two minutes", () => {
    const session = new Session(makeDoc("one two three"), 4);
    session.type("A");
    session.select(9);
    session.type("B");
    expect(session.suggestions).toHaveLength(2);
    session.select(10);
    session.later(GROUP_TIMEOUT_MS + 1);
    session.type("C");
    expect(session.suggestions).toHaveLength(3);
    session.later(1000);
    session.type("D");
    expect(session.suggestions).toHaveLength(3);
  });

  it("splits a paragraph as a suggested break, and rejecting joins it again", () => {
    const session = new Session(makeDoc("abcdef"), 4);
    session.edit((state) => state.tr.split(state.selection.from));
    expect(session.state.doc.childCount).toBe(2);
    expect(session.state.doc.child(1).attrs.suggestionBreak).toMatchObject({ kind: "insert" });
    expect(session.state.selection.$from.parent.textContent).toBe("def");
    session.type("X");
    expect(session.suggestions).toHaveLength(1);
    session.resolve("reject");
    expect(session.state.doc.childCount).toBe(1);
    expect(session.text).toBe("abcdef");
  });

  it("joins paragraphs as a suggested deletion, and accepting joins them", () => {
    const session = new Session(makeDoc("one", "two"), 6);
    session.edit((state) => state.tr.delete(4, 6));
    expect(session.state.doc.childCount).toBe(2);
    expect(session.state.doc.child(1).attrs.suggestionBreak).toMatchObject({ kind: "delete" });
    expect(session.state.selection.from).toBe(4);
    session.resolve("accept");
    expect(session.state.doc.childCount).toBe(1);
    expect(session.text).toBe("onetwo");
  });

  it("deletes across paragraphs and accepts the result", () => {
    const session = new Session(makeDoc("Hello world", "Second line"));
    session.select(7, 21);
    session.edit((state) => state.tr.deleteSelection());
    expect(session.text).toBe("Hello world|Second line");
    expect(session.descriptions()).toEqual(["Delete: “world Second”"]);
    session.resolve("accept");
    expect(session.text).toBe("Hello line");
  });
});

describe("suggesting: the suggestion being made", () => {
  it("is the insertion, deletion or replacement the edit made or extended", () => {
    const session = new Session(makeDoc("Hello world"), 6);
    session.type("!");
    const [inserted] = session.suggestions;
    expect(session.made).toBe(inserted!.id);
    session.select(13);
    session.backspace();
    const deleted = session.suggestions.find((suggestion) => suggestion.deleted === "d");
    expect(session.made).toBe(deleted!.id);
    session.type("D");
    expect(session.made).toBe(deleted!.id);
    expect(session.suggestions).toHaveLength(2);
  });

  it("is the format suggestion a formatting change made or extended, and none when it was undone", () => {
    const session = new Session(makeDoc("Hello world"));
    session.edit((state) => state.tr.addMark(7, 12, documentSchema.marks.bold!.create()));
    const [format] = session.suggestions;
    expect(session.made).toBe(format!.id);
    session.edit((state) => state.tr.addMark(7, 12, documentSchema.marks.italic!.create()));
    expect(session.made).toBe(format!.id);
    session.edit((state) => state.tr.removeMark(7, 12, documentSchema.marks.italic!).removeMark(7, 12, documentSchema.marks.bold!));
    expect(session.suggestions).toHaveLength(0);
    expect(session.made).toBeNull();
  });
});

describe("suggesting: formatting", () => {
  it("records bold as a format suggestion and restores the old formatting on reject", () => {
    const session = new Session(makeDoc("Hello world"));
    session.select(7, 12);
    session.edit((state) => state.tr.addMark(7, 12, documentSchema.marks.bold!.create()));
    expect(session.descriptions()).toEqual(["Format: bold"]);
    session.select(7, 12);
    session.edit((state) => state.tr.addMark(7, 12, documentSchema.marks.textStyle!.create({ fontFamily: "Georgia" })));
    expect(session.suggestions).toHaveLength(1);
    expect(session.descriptions()).toEqual(["Format: bold, font"]);
    session.resolve("reject");
    expect(session.state.doc.rangeHasMark(1, 12, documentSchema.marks.bold!)).toBe(false);
    expect(session.state.doc.rangeHasMark(1, 12, documentSchema.marks.textStyle!)).toBe(false);
    expect(session.suggestions).toHaveLength(0);
  });

  it("removes the record when a change is undone by the opposite change", () => {
    const session = new Session(makeDoc("Hello"));
    session.edit((state) => state.tr.addMark(1, 6, documentSchema.marks.italic!.create()));
    session.edit((state) => state.tr.removeMark(1, 6, documentSchema.marks.italic!));
    expect(session.suggestions).toHaveLength(0);
  });

  it("accepting keeps the new formatting", () => {
    const session = new Session(makeDoc("Hello"));
    session.edit((state) => state.tr.addMark(1, 6, documentSchema.marks.bold!.create()));
    session.resolve("accept");
    expect(session.state.doc.rangeHasMark(1, 6, documentSchema.marks.bold!)).toBe(true);
    expect(session.suggestions).toHaveLength(0);
  });

  it("records paragraph style and alignment changes and reverts them", () => {
    const session = new Session(makeDoc("Title text", "Body"));
    session.edit((state) => state.tr.setBlockType(1, 1, documentSchema.nodes.heading!, { level: 1 }));
    session.edit((state) => state.tr.setNodeAttribute(12, "textAlign", "center"));
    expect(session.descriptions()).toEqual(["Format: paragraph style", "Format: alignment"]);
    session.resolve("reject");
    expect(session.state.doc.child(0).type.name).toBe("paragraph");
    expect(session.state.doc.child(1).attrs.textAlign).toBeNull();
  });

  it("records a new bulleted list and reverts it", () => {
    const session = new Session(makeDoc("Item"));
    session.edit((state) => {
      let result: Transaction | null = null;
      wrapInList(documentSchema.nodes.bulletList!)(state, (tr) => (result = tr));
      return result!;
    });
    expect(session.state.doc.child(0).type.name).toBe("bulletList");
    expect(session.descriptions()).toEqual(["Format: bulleted list"]);
    session.resolve("reject");
    expect(session.state.doc.child(0).type.name).toBe("paragraph");
    expect(session.text).toBe("Item");
  });
});

describe("accepting and rejecting", () => {
  function threeSuggestions(): Session {
    const session = new Session(makeDoc("one two three"), 4);
    session.type("!");
    session.select(6, 9);
    session.edit((state) => state.tr.deleteSelection());
    session.edit((state) => state.tr.addMark(11, 16, documentSchema.marks.bold!.create()));
    return session;
  }

  it("accepts every suggestion in one step", () => {
    const session = threeSuggestions();
    expect(session.suggestions).toHaveLength(3);
    const tr = resolveSuggestions(session.state, "accept", null)!;
    expect(tr.getMeta("suggestionCommand")).toBe(true);
    session.state = session.state.apply(tr);
    expect(session.text).toBe("one!  three");
    expect(session.state.doc.rangeHasMark(1, 11, documentSchema.marks.bold!)).toBe(true);
    expect(session.suggestions).toHaveLength(0);
  });

  it("rejects every suggestion", () => {
    const session = threeSuggestions();
    session.resolve("reject");
    expect(session.text).toBe("one two three");
    expect(session.state.doc.rangeHasMark(1, 14, documentSchema.marks.bold!)).toBe(false);
  });

  it("accepts one suggestion and leaves the others", () => {
    const session = threeSuggestions();
    const [insert] = session.suggestions;
    session.resolve("accept", [insert!.id]);
    expect(session.suggestions).toHaveLength(2);
    expect(markedText(session.state.doc, "suggestionInsert")).toBe("");
  });

  it("works on a plain Transform, as the server's exports use it", () => {
    const session = threeSuggestions();
    const accepted = applySuggestions(new Transform(session.state.doc), "accept").doc;
    expect(accepted.textContent).toBe("one!  three");
    expect(() => accepted.check()).not.toThrow();
  });
});

describe("transactions that pass through", () => {
  it("leaves undo and collab transactions alone", () => {
    const state = EditorState.create({ doc: makeDoc("Hello") });
    const context: SuggestContext = { author: "You", now: 0, group: null };
    expect(suggestTransaction(state, state.tr.insertText("x", 1).setMeta("addToHistory", false), context)).toBeNull();
    expect(suggestTransaction(state, state.tr.insertText("x", 1).setMeta("history$", { redo: false }), context)).toBeNull();
  });
});

describe("word count and find read the accepted result", () => {
  const withDeletion = () =>
    Node.fromJSON(documentSchema, {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            text("keep "),
            text("gone ", [{ type: "suggestionDelete", attrs: { id: "d", author: "You", createdAt: 0 } }]),
            text("goneish here"),
          ],
        },
      ],
    });

  it("does not count deleted text", () => {
    const state = EditorState.create({ doc: withDeletion() });
    expect(documentStats(state).total.words).toBe(3);
  });

  it("does not match deleted text and maps matches after it to the right positions", () => {
    const doc = withDeletion();
    const matches = findMatches(doc, { ...defaultSearchOptions, query: "gone" });
    expect(matches).toHaveLength(1);
    expect(doc.textBetween(matches[0]!.from, matches[0]!.to)).toBe("gone");
    expect(matches[0]!.from).toBe(1 + "keep gone ".length);
    // Text either side of a deletion matches as if the deletion were accepted.
    const across = findMatches(doc, { ...defaultSearchOptions, query: "keep goneish" });
    expect(across).toHaveLength(1);
    expect(across[0]).toEqual({ from: 1, to: 1 + "keep gone goneish".length });
  });
});
