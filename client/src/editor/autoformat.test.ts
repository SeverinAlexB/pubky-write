import { collectSuggestions, documentSchema } from "@docs/shared";
import { Node } from "@tiptap/pm/model";
import { history, undo } from "@tiptap/pm/history";
import { EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { planChange } from "./autoformat.ts";
import { autoChange, isImmediate, linkTarget, type AutoContext } from "./autoformatRules.ts";
import { defaultPreferences, parsePreferences, type Preferences } from "./preferences.ts";
import { getSuggesting, Suggesting, suggestTransaction } from "./suggesting.ts";

const start: AutoContext = { fromStart: true, plainParagraph: true, atParagraphEnd: true };

/** Applies `autoChange` to typing `value` one character at a time, as the editor would. */
function typeText(value: string, preferences: Preferences = defaultPreferences()): string {
  let text = "";
  for (const character of value) {
    const change = autoChange(text, character, preferences, { ...start, plainParagraph: !text.startsWith("•") });
    text += character;
    if (change?.kind === "replace") text = text.slice(0, change.from) + change.text + text.slice(change.to);
  }
  return text;
}

describe("autoChange", () => {
  it("makes the acceptance example's quotes, dash and substitutions", () => {
    expect(typeText('"hi" -- (c) 1/2 ')).toBe("“hi” – © ½ ");
  });

  it("uses opening and closing quotes and apostrophes by position", () => {
    expect(typeText("it's 'one' (\"two\")")).toBe("It’s ‘one’ (“two”)");
    expect(typeText("rock 'n' roll")).toBe("Rock ‘n’ roll");
  });

  it("replaces symbol sequences at once and words when they are completed", () => {
    expect(typeText("a --> b <== c <=> d ==> e <-- f")).toBe("A → b ⇐ c ⇔ d ⇒ e ← f");
    expect(typeText("x --- y")).toBe("X — y");
    expect(typeText("wait... ")).toBe("Wait… ");
    expect(typeText("acme tm, c/o 3/4.")).toBe("Acme ™, ℅ ¾.");
    // Only whole words: not inside "atm" or "11/2".
    expect(typeText("atm 11/2 ")).toBe("Atm 11/2 ");
    // Fractions wait for the end of the number.
    expect(typeText("1/25 ")).toBe("1/25 ");
  });

  it("capitalises the first word of a sentence and i", () => {
    expect(typeText("hello world. this is i. why? because! ok ")).toBe("Hello world. This is I. Why? Because! Ok ");
    expect(typeText("so i'm here ")).toBe("So I’m here ");
    // Not addresses, words with capitals or digits, or words after the start that are not a sentence start.
    expect(typeText("example.com iPhone ")).toBe("example.com iPhone ");
    const change = autoChange("more text", " ", defaultPreferences(), { ...start, fromStart: false });
    expect(change).toBeNull();
  });

  it("detects web addresses followed by a space or Enter", () => {
    expect(autoChange("see example.com", " ", defaultPreferences(), start)).toEqual({
      kind: "link",
      from: 4,
      to: 15,
      href: "https://example.com",
    });
    expect(autoChange("(www.example.org/path).", "", defaultPreferences(), start)).toMatchObject({
      kind: "link",
      from: 1,
      to: 21,
      href: "https://www.example.org/path",
    });
    expect(linkTarget("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(linkTarget("notes.txt")).toBeNull();
    expect(linkTarget("readme.md")).toBeNull();
    expect(linkTarget("e.g.")).toBeNull();
  });

  it("starts lists, headings, quotes and code blocks at the start of a paragraph", () => {
    const preferences = defaultPreferences();
    expect(autoChange("1.", " ", preferences, start)).toMatchObject({ kind: "block", block: { type: "list", list: "numbered", preset: "decimal" }, markerLength: 3 });
    expect(autoChange("1)", " ", preferences, start)).toMatchObject({ block: { list: "numbered", preset: "decimal-parenthesis" } });
    expect(autoChange("a.", " ", preferences, start)).toMatchObject({ block: { list: "numbered", preset: "upper-alpha" } });
    expect(autoChange("*", " ", preferences, start)).toMatchObject({ block: { type: "list", list: "bullet" } });
    expect(autoChange("-", " ", preferences, start)).toMatchObject({ block: { type: "list", list: "bullet" } });
    expect(autoChange("##", " ", preferences, start)).toMatchObject({ block: { type: "heading", level: 2 } });
    expect(autoChange(">", " ", preferences, start)).toMatchObject({ block: { type: "blockquote" } });
    expect(autoChange("```", " ", preferences, start)).toMatchObject({ block: { type: "codeBlock" } });
    expect(autoChange("--", "-", preferences, start)).toEqual({ kind: "horizontalRule" });
    // Not in a list or later in the paragraph.
    expect(autoChange("1.", " ", preferences, { ...start, plainParagraph: false })).toBeNull();
    expect(autoChange("x 1.", " ", preferences, start)).toBeNull();
  });

  it("applies Markdown emphasis when the closing delimiter is typed", () => {
    const preferences = defaultPreferences();
    expect(autoChange("make **bold*", "*", preferences, start)).toEqual({ kind: "mark", mark: "bold", open: [5, 7], close: [11, 13] });
    expect(autoChange("an *it", "*", preferences, start)).toEqual({ kind: "mark", mark: "italic", open: [3, 4], close: [6, 7] });
    expect(autoChange("~~gone~", "~", preferences, start)).toEqual({ kind: "mark", mark: "strike", open: [0, 2], close: [6, 8] });
    expect(autoChange("run `npm", "`", preferences, start)).toEqual({ kind: "mark", mark: "code", open: [4, 5], close: [8, 9] });
    // The first closing star of **bold** is not italic, and 2*3*4 is not emphasis.
    expect(autoChange("**bold", "*", preferences, start)).toBeNull();
    expect(autoChange("2*3", "*", preferences, start)).toBeNull();
  });

  it("does nothing for a preference that is off", () => {
    const off = {
      ...defaultPreferences(),
      autoCapitalise: false,
      smartQuotes: false,
      autoLinks: false,
      autoLists: false,
      markdown: false,
      substitutionsEnabled: false,
    };
    expect(typeText('"hi" -- (c) 1/2 example.com ', off)).toBe('"hi" -- (c) 1/2 example.com ');
    expect(autoChange("1.", " ", off, start)).toBeNull();
    expect(autoChange("##", " ", off, start)).toBeNull();
    expect(autoChange("**b*", "*", off, start)).toBeNull();
    // A single substitution can be switched off.
    const noCopyright = defaultPreferences();
    noCopyright.substitutions = noCopyright.substitutions.map((pair) => (pair.replace === "(c)" ? { ...pair, enabled: false } : pair));
    expect(typeText("(c) (r) ", noCopyright)).toBe("(c) ® ");
  });

  it("knows which pairs are replaced at once", () => {
    const pairs = defaultPreferences().substitutions;
    expect(isImmediate("-->", pairs)).toBe(true);
    expect(isImmediate("--", pairs)).toBe(false);
    expect(isImmediate("tm", pairs)).toBe(false);
    expect(isImmediate("(c)", pairs)).toBe(true);
  });
});

describe("preferences", () => {
  it("reads stored preferences over the defaults and ignores malformed values", () => {
    expect(parsePreferences(null)).toEqual(defaultPreferences());
    expect(parsePreferences("not json")).toEqual(defaultPreferences());
    const stored = parsePreferences(JSON.stringify({ smartQuotes: false, autoLinks: "no", substitutions: [{ replace: "omw", with: "on my way" }, { replace: "" }] }));
    expect(stored.smartQuotes).toBe(false);
    expect(stored.autoLinks).toBe(true);
    expect(stored.substitutions).toEqual([{ replace: "omw", with: "on my way", enabled: true }]);
  });
});

/** An editor state with undo history and, optionally, Suggesting mode. */
function editorState(text: string, mode: "editing" | "suggesting" = "editing"): EditorState {
  const doc = Node.fromJSON(documentSchema, { type: "doc", content: [{ type: "paragraph", ...(text && { content: [{ type: "text", text }] }) }] });
  const suggesting = Suggesting.config.addProseMirrorPlugins!.call({ options: { initialMode: mode, author: "You", onActivate: () => {} } } as never);
  return EditorState.create({ doc, plugins: [history(), ...suggesting], selection: TextSelection.create(doc, 1 + text.length) });
}

/** Applies a transaction as the editor's dispatch hook does (rewritten into suggestions in Suggesting mode). */
function apply(state: EditorState, tr: Transaction): EditorState {
  if (getSuggesting(state).mode !== "suggesting") return state.apply(tr);
  const result = suggestTransaction(state, tr, { author: "You", now: 1_000_000, group: getSuggesting(state).group });
  return state.apply(result?.tr ?? tr);
}

/** Types `value` like the autoformat plugin: the character, then the automatic change. */
function type(state: EditorState, value: string): EditorState {
  let current = state;
  for (const character of value) {
    const change = planChange(current, character);
    current = apply(current, current.tr.insertText(character));
    const tr = change?.(current);
    if (tr) current = apply(current, tr);
  }
  return current;
}

const textOf = (state: EditorState) => state.doc.textBetween(0, state.doc.content.size, "|");

describe("autoformat in the editor", () => {
  it("undoes only the automatic change, restoring what was typed", () => {
    let state = type(editorState(""), "x (c)");
    expect(textOf(state)).toBe("X ©");
    undo(state, (tr) => (state = state.apply(tr)));
    expect(textOf(state)).toBe("X (c)");
    state = type(editorState(""), '"');
    expect(textOf(state)).toBe("“");
    undo(state, (tr) => (state = state.apply(tr)));
    expect(textOf(state)).toBe('"');
  });

  it("turns Markdown into formatting and lists, keeping the text", () => {
    let state = type(editorState(""), "a **bold** b");
    expect(textOf(state)).toBe("A bold b");
    const bold = state.doc.firstChild!.child(1);
    expect(bold.text).toBe("bold");
    expect(bold.marks.map((mark) => mark.type.name)).toEqual(["bold"]);
    // Text typed after the closing delimiter is not bold.
    expect(state.doc.firstChild!.lastChild!.marks).toEqual([]);

    state = type(editorState(""), "1. one");
    expect(state.doc.firstChild!.type.name).toBe("orderedList");
    expect(textOf(state)).toBe("one");
    state = type(editorState(""), "## Title");
    expect(state.doc.firstChild!.type.name).toBe("heading");
    expect(state.doc.firstChild!.attrs.level).toBe(2);
    undo(state, (tr) => (state = state.apply(tr)));
    expect(state.doc.firstChild!.type.name).toBe("paragraph");
  });

  it("links an address when a space follows it", () => {
    const state = type(editorState(""), "example.com ");
    const link = state.doc.firstChild!.firstChild!;
    expect(link.text).toBe("example.com");
    expect(link.marks[0]?.attrs.href).toBe("https://example.com");
  });

  it("makes suggestions in Suggesting mode, including the formatting of Markdown shortcuts", () => {
    let state = type(editorState("Old", "suggesting"), " **new**");
    expect(textOf(state)).toBe("Old new");
    const added = state.doc.firstChild!.child(2);
    expect(added.text).toBe("new");
    expect(added.marks.map((mark) => mark.type.name).sort()).toEqual(["bold", "suggestionInsert"]);
    expect(collectSuggestions(state.doc)).toHaveLength(1);

    state = type(editorState("", "suggesting"), "## Head");
    expect(state.doc.firstChild!.type.name).toBe("heading");
    expect(state.doc.firstChild!.attrs.suggestionFormat?.before.type).toBe("paragraph");
    expect(textOf(state)).toBe("Head");

    state = type(editorState("", "suggesting"), "x -- y ");
    expect(textOf(state)).toBe("X – y ");
    expect(collectSuggestions(state.doc).every((suggestion) => suggestion.ranges.length > 0)).toBe(true);
  });
});
