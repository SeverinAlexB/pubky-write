import { documentSchema } from "@docs/shared";
import { Node } from "@tiptap/pm/model";
import { history, undo } from "@tiptap/pm/history";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { parseFontSize, stepFontSize } from "./fonts.ts";
import {
  defaultSearchOptions,
  findMatches,
  foldText,
  getSearchState,
  goToMatch,
  replaceAll,
  replaceCurrent,
  Search,
  setSearch,
  type SearchOptions,
} from "./search.ts";
import { countText } from "./textStats.ts";

const doc = (...paragraphs: unknown[][]) =>
  Node.fromJSON(documentSchema, {
    type: "doc",
    content: paragraphs.map((content) => ({ type: "paragraph", content })),
  });
const text = (value: string, marks?: unknown[]) => ({ type: "text", text: value, ...(marks && { marks }) });

function searchState(document: Node): EditorState {
  const plugins = Search.config.addProseMirrorPlugins!.call({} as never);
  return EditorState.create({ doc: document, plugins });
}

const options = (query: string, overrides: Partial<SearchOptions> = {}): SearchOptions => ({
  ...defaultSearchOptions,
  query,
  ...overrides,
});

describe("findMatches", () => {
  it("finds matches across differently formatted text and ignores case by default", () => {
    const document = doc([text("The "), text("Cat", [{ type: "bold" }]), text("alog of cats")]);
    // Paragraph content starts at position 1.
    expect(findMatches(document, options("cat"))).toEqual([
      { from: 5, to: 8 },
      { from: 16, to: 19 },
    ]);
    expect(findMatches(document, options("cat", { caseSensitive: true }))).toEqual([{ from: 16, to: 19 }]);
  });

  it("keeps positions right after inline nodes and never matches across paragraphs", () => {
    const document = doc([text("ab"), { type: "hardBreak" }, text("ab")], [text("b")]);
    expect(findMatches(document, options("ab"))).toEqual([
      { from: 1, to: 3 },
      { from: 4, to: 6 },
    ]);
    expect(findMatches(document, options("bb"))).toEqual([]);
  });

  it("ignores diacritics and maps positions back when normalising changes lengths", () => {
    // "e\u0301" is e + combining acute (two units, one letter); "É" and "ä" are precomposed.
    const document = doc([text("caf\u00e9 cafe\u0301 Cafe x\u00e4\u00e4y")]);
    const found = findMatches(document, options("cafe"));
    expect(found).toEqual([
      { from: 1, to: 5 },
      // The combining mark after the match belongs to it.
      { from: 6, to: 11 },
      { from: 12, to: 16 },
    ]);
    expect(findMatches(document, options("aa"))).toEqual([{ from: 18, to: 20 }]);
    // A query with accents matches the same text, and only accented text with the option off.
    expect(findMatches(document, options("café"))).toHaveLength(3);
    expect(findMatches(document, options("café", { ignoreDiacritics: false }))).toEqual([{ from: 1, to: 5 }]);
    expect(findMatches(document, options("Cafe", { caseSensitive: true }))).toEqual([{ from: 12, to: 16 }]);
    expect(findMatches(doc([text("\u00c9t\u00e9")]), options("ete"))).toEqual([{ from: 1, to: 4 }]);
  });

  it("maps a match that ends after a decomposed letter", () => {
    const document = doc([text("a\u0308b")]);
    expect(findMatches(document, options("a"))).toEqual([{ from: 1, to: 3 }]);
    expect(findMatches(document, options("b"))).toEqual([{ from: 3, to: 4 }]);
    expect(foldText("a\u0308b", true)).toEqual({ text: "ab", starts: [0, 2], ends: [1, 3] });
  });

  it("supports regular expressions and treats invalid ones as no matches", () => {
    const document = doc([text("ann@x bob@y cy@x")], [text("line"), { type: "hardBreak" }, text("two")]);
    expect(findMatches(document, options("(\\w+)@x", { regex: true })).map(({ from, to }) => ({ from, to }))).toEqual([
      { from: 1, to: 6 },
      { from: 13, to: 17 },
    ]);
    expect(findMatches(document, options("e\\nt", { regex: true }))).toHaveLength(1);
    expect(findMatches(document, options("(unclosed", { regex: true }))).toEqual([]);
    expect(findMatches(document, options("x*", { regex: true }))).toHaveLength(2);
    // Without the option, the query is plain text.
    expect(findMatches(document, options("(\\w+)@x"))).toEqual([]);
  });
});

describe("search plugin", () => {
  it("cycles through matches and replaces them", () => {
    let state = searchState(doc([text("one two one two one")]));
    state = state.apply(setSearch(state.tr, { query: "one" }));
    expect(getSearchState(state)).toMatchObject({ current: 0, matches: [{ from: 1 }, { from: 9 }, { from: 17 }] });

    state = state.apply(goToMatch(state, 1)!);
    expect(getSearchState(state).current).toBe(1);
    expect(state.doc.textBetween(state.selection.from, state.selection.to)).toBe("one");

    state = state.apply(replaceCurrent(state, "1")!);
    expect(state.doc.textContent).toBe("one two 1 two one");
    // The current match moves on to the one after the replaced text.
    expect(getSearchState(state)).toMatchObject({ current: 1, matches: [{ from: 1 }, { from: 15 }] });

    state = state.apply(replaceAll(state, "1")!);
    expect(state.doc.textContent).toBe("1 two 1 two 1");
    expect(getSearchState(state)).toMatchObject({ matches: [], current: -1 });
  });

  it("starts at the first match at or after the cursor and wraps around", () => {
    let state = searchState(doc([text("item item item item")]));
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 7)));
    state = state.apply(setSearch(state.tr, { query: "item" }));
    expect(getSearchState(state).current).toBe(2);
    state = state.apply(goToMatch(state, 1)!);
    state = state.apply(goToMatch(state, 1)!);
    expect(getSearchState(state).current).toBe(0);
    state = state.apply(goToMatch(state, -1)!);
    expect(getSearchState(state).current).toBe(3);
  });

  it("inserts regular expression groups from the original text", () => {
    let state = searchState(doc([text("ann@x b\u00e9a@x cy@y")]));
    state = state.apply(setSearch(state.tr, { query: "(\\w+)@x", regex: true }));
    state = state.apply(replaceAll(state, "<$1>")!);
    expect(state.doc.textContent).toBe("<ann> <béa> cy@y");

    state = state.apply(setSearch(state.tr, { query: "(?<name>c)(y)@(y)" }));
    state = state.apply(replaceCurrent(state, "$2$<name>$$$&$9")!);
    expect(state.doc.textContent).toBe("<ann> <béa> yc$cy@y$9");
  });

  it("replaces all matches in one undo step", () => {
    let state = EditorState.create({
      doc: doc([text("red fish, blue fish, Red fish")]),
      plugins: [...Search.config.addProseMirrorPlugins!.call({} as never), history()],
    });
    state = state.apply(setSearch(state.tr, { query: "red" }));
    state = state.apply(replaceAll(state, "green")!);
    expect(state.doc.textContent).toBe("green fish, blue fish, green fish");
    undo(state, (tr) => (state = state.apply(tr)));
    expect(state.doc.textContent).toBe("red fish, blue fish, Red fish");
  });
});

describe("countText", () => {
  it("counts words and characters like a word processor", () => {
    expect(countText("Hello, world! It's 2026.\nNew line")).toEqual({ words: 6, characters: 32, charactersExcludingSpaces: 28 });
    expect(countText("")).toEqual({ words: 0, characters: 0, charactersExcludingSpaces: 0 });
  });
});

describe("font sizes", () => {
  it("steps through the standard sizes", () => {
    expect(stepFontSize(11, 1)).toBe(12);
    expect(stepFontSize(13, 1)).toBe(14);
    expect(stepFontSize(13, -1)).toBe(12);
    expect(stepFontSize(96, 1)).toBe(97);
    expect(stepFontSize(8, -1)).toBe(7);
  });

  it("reads stored sizes in points or pixels", () => {
    expect(parseFontSize("11pt")).toBe(11);
    expect(parseFontSize("16px")).toBe(12);
    expect(parseFontSize("large")).toBeNull();
  });
});
