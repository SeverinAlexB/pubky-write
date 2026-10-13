import { documentSchema } from "@docs/shared";
import { Node } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { parseFontSize, stepFontSize } from "./fonts.ts";
import { findMatches, getSearchState, goToMatch, replaceAll, replaceCurrent, Search, setSearch } from "./search.ts";
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

describe("findMatches", () => {
  it("finds matches across differently formatted text and ignores case by default", () => {
    const document = doc([text("The "), text("Cat", [{ type: "bold" }]), text("alog of cats")]);
    // Paragraph content starts at position 1.
    expect(findMatches(document, "cat", false)).toEqual([
      { from: 5, to: 8 },
      { from: 16, to: 19 },
    ]);
    expect(findMatches(document, "cat", true)).toEqual([{ from: 16, to: 19 }]);
  });

  it("keeps positions right after inline nodes and never matches across paragraphs", () => {
    const document = doc([text("ab"), { type: "hardBreak" }, text("ab")], [text("b")]);
    expect(findMatches(document, "ab", false)).toEqual([
      { from: 1, to: 3 },
      { from: 4, to: 6 },
    ]);
    expect(findMatches(document, "bb", false)).toEqual([]);
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
    expect(getSearchState(state).matches).toHaveLength(2);

    state = state.apply(replaceAll(state, "1")!);
    expect(state.doc.textContent).toBe("1 two 1 two 1");
    expect(getSearchState(state)).toMatchObject({ matches: [], current: -1 });
  });
});

describe("countText", () => {
  it("counts words and characters like a word processor", () => {
    expect(countText("Hello, world! It's 2026.\nNew line")).toEqual({
      words: 6,
      characters: 32,
      charactersExcludingSpaces: 28,
    });
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
