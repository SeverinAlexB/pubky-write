import { documentSchema, findTab, type TabAttrs } from "@docs/shared";
import type { JSONContent } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";
import { EditorState, TextSelection, type Command, type Transaction } from "@tiptap/pm/state";
import { tableEditing } from "@tiptap/pm/tables";
import { describe, expect, it } from "vitest";
import { addTab, deleteTab, DocumentTabs, setTabAttribute, switchTab } from "./documentTabs.ts";
import { closeHistory, redo, redoDepth, SHARED, tabHistory, timelineOf, undo, undoDepth } from "./tabHistory.ts";

const paragraph = (text: string): JSONContent => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
const tab = (attrs: Partial<TabAttrs> & { id: string }, ...texts: string[]): JSONContent => ({
  type: "documentTab",
  attrs: { name: attrs.id, ...attrs },
  content: texts.map(paragraph),
});

function stateOf(content: JSONContent[]): EditorState {
  const plugins = [...DocumentTabs.config.addProseMirrorPlugins!.call({ options: { initialTab: null } } as never), tableEditing(), tabHistory()];
  return EditorState.create({ doc: Node.fromJSON(documentSchema, { type: "doc", content }), plugins });
}

let time = 1000;
/** Applies a transaction as the view does, a second after the one before (so edits are separate undo steps). */
function apply(state: EditorState, tr: Transaction | null): EditorState {
  if (!tr) throw new Error("No transaction");
  return state.applyTransaction(tr.setTime((time += 1000))).state;
}

function run(state: EditorState, command: Command): EditorState {
  let next = state;
  if (!command(state, (tr) => (next = apply(state, tr)))) throw new Error("The command was not possible");
  return next;
}

/** Types at the end of tab `id`'s last paragraph. */
function typeIn(state: EditorState, id: string, text: string): EditorState {
  const shown = apply(state, switchTab(state, id));
  const end = findTab(shown.doc, id)!.to - 1;
  return apply(shown, shown.tr.insertText(text, end));
}

const show = (state: EditorState, id: string) => apply(state, switchTab(state, id));
const texts = (state: EditorState) => [...state.doc.children].map((node) => node.textContent);

describe("undo per tab", () => {
  const twoTabs = () => stateOf([tab({ id: "a", order: 0 }, "A"), tab({ id: "b", order: 1 }, "B")]);

  it("undoes the shown tab's edits and keeps the other tabs'", () => {
    let state = typeIn(twoTabs(), "a", "1");
    state = typeIn(state, "b", "2");
    state = typeIn(state, "a", "3");
    // Shown: tab b. Its edit is undone even though tab a's edit came later.
    state = show(state, "b");
    state = run(state, undo);
    expect(texts(state)).toEqual(["A13", "B"]);
    expect(undoDepth(state)).toBe(0);
    state = show(state, "a");
    state = run(state, undo);
    expect(texts(state)).toEqual(["A1", "B"]);
    state = run(state, undo);
    expect(texts(state)).toEqual(["A", "B"]);
    expect(undoDepth(state)).toBe(0);
    // Redo per tab too.
    state = run(state, redo);
    expect(texts(state)).toEqual(["A1", "B"]);
    state = show(state, "b");
    state = run(state, redo);
    expect(texts(state)).toEqual(["A1", "B2"]);
  });

  it("maps an undone edit over later edits in other tabs", () => {
    let state = typeIn(twoTabs(), "b", "x");
    // Text added before tab b moves its positions.
    state = typeIn(state, "a", "longer text");
    state = show(state, "b");
    state = run(state, undo);
    expect(texts(state)).toEqual(["Alonger text", "B"]);
  });

  it("reaches a document-wide change when it is the latest in the shown tab's timeline", () => {
    let state = typeIn(twoTabs(), "a", "1");
    state = apply(state, closeHistory(state.tr.setDocAttribute("columns", 2)));
    state = typeIn(state, "b", "2");
    // From tab a the page setup is the latest change; from tab b its own edit is.
    state = show(state, "a");
    state = run(state, undo);
    expect(state.doc.attrs.columns).toBe(1);
    expect(texts(state)).toEqual(["A1", "B2"]);
    state = run(state, undo);
    expect(texts(state)).toEqual(["A", "B2"]);
    // Redo brings the page setup back after the tab's edit.
    state = run(state, redo);
    state = run(state, redo);
    expect(state.doc.attrs.columns).toBe(2);
  });

  it("records tab commands in the shared timeline", () => {
    let state = twoTabs();
    state = apply(state, setTabAttribute(state, "a", "name", "Renamed"));
    state = apply(state, addTab(state, "a"));
    state = apply(state, deleteTab(state, "b"));
    // Undo from whichever tab is shown: the deleted tab comes back with its content.
    state = run(state, undo);
    expect(texts(state)).toEqual(["A", "B", ""]);
    state = run(state, undo);
    expect(texts(state)).toEqual(["A", "B"]);
    state = run(state, undo);
    expect(findTab(state.doc, "a")!.name).toBe("a");
  });

  it("knows the timeline of a change", () => {
    const state = twoTabs();
    expect(timelineOf(state.tr.insertText("x", findTab(state.doc, "b")!.from + 1))).toBe("b");
    expect(timelineOf(state.tr.setDocAttribute("columns", 2))).toBe(SHARED);
    expect(timelineOf(setTabAttribute(state, "a", "emoji", "🙂")!)).toBe(SHARED);
    const single = stateOf([paragraph("one")]);
    expect(timelineOf(single.tr.insertText("x", 1))).toBe("t.0");
    expect(timelineOf(addTab(single, "t.0"))).toBe(SHARED);
  });

  it("groups typing and starts a new step after a new edit clears redo", () => {
    let state = show(twoTabs(), "a");
    const end = () => findTab(state.doc, "a")!.to - 1;
    state = state.applyTransaction(state.tr.insertText("x", end()).setTime(50_000)).state;
    state = state.applyTransaction(state.tr.insertText("y", end()).setTime(50_100)).state;
    expect(undoDepth(state)).toBe(1);
    state = run(state, undo);
    expect(texts(state)).toEqual(["A", "B"]);
    expect(redoDepth(state)).toBe(1);
    state = apply(state, state.tr.insertText("z", end()));
    expect(redoDepth(state)).toBe(0);
  });

  it("undoes an inserted table and a wrapped document", () => {
    let state = stateOf([paragraph("one")]);
    const cell = () => documentSchema.nodes.tableCell!.create(null, documentSchema.nodes.paragraph!.create());
    const table = documentSchema.nodes.table!.create(null, [documentSchema.nodes.tableRow!.create(null, [cell(), cell()])]);
    const original = state.doc;
    state = apply(state, state.tr.setSelection(TextSelection.create(state.doc, 1)).replaceSelectionWith(table));
    state = apply(state, addTab(state, "t.0"));
    state = run(state, undo);
    state = run(state, undo);
    expect(state.doc.eq(original)).toBe(true);
  });
});
