import { documentSchema, documentTabs, FIRST_TAB_ID, findTab, tabTree, type TabAttrs } from "@docs/shared";
import type { JSONContent } from "@tiptap/core";
import { deleteSelection, joinBackward, selectAll } from "@tiptap/pm/commands";
import { history, redo, undo } from "@tiptap/pm/history";
import { Node } from "@tiptap/pm/model";
import { EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import {
  addSubtab,
  addTab,
  canAddSubtab,
  canMoveTab,
  currentTab,
  deleteTab,
  DocumentTabs,
  documentTabsKey,
  duplicateTab,
  moveTab,
  moveTabInto,
  moveTargets,
  nextTabName,
  setTabAttribute,
  switchTab,
} from "./documentTabs.ts";
import { Search, getSearchState, setSearch, defaultSearchOptions } from "./search.ts";
import { documentStats } from "./textStats.ts";

const paragraph = (text: string): JSONContent => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
const tab = (attrs: Partial<TabAttrs> & { id: string }, ...texts: string[]): JSONContent => ({
  type: "documentTab",
  attrs: { name: attrs.id, ...attrs },
  content: texts.map(paragraph),
});

function stateOf(content: JSONContent[], initialTab: string | null = null): EditorState {
  const plugins = [
    history(),
    ...DocumentTabs.config.addProseMirrorPlugins!.call({ options: { initialTab } } as never),
    ...Search.config.addProseMirrorPlugins!.call({} as never),
  ];
  return EditorState.create({ doc: Node.fromJSON(documentSchema, { type: "doc", content }), plugins });
}

function run(state: EditorState, command: (state: EditorState) => Transaction | null): EditorState {
  const tr = command(state);
  if (!tr) throw new Error("The command was not possible");
  return state.apply(tr);
}

/** The state after a ProseMirror command, with appended transactions (as the view applies them). */
function dispatch(state: EditorState, command: (state: EditorState, dispatch: (tr: Transaction) => void) => boolean): EditorState {
  let next = state;
  command(state, (tr) => {
    next = state.applyTransaction(tr).state;
  });
  return next;
}

const names = (state: EditorState) => tabTree(state.doc).map((entry) => `${"  ".repeat(entry.depth)}${entry.name}`);
const shown = (state: EditorState) => currentTab(state).name;

describe("the shown tab", () => {
  it("is the first tab, or the one asked for", () => {
    const content = [tab({ id: "a", name: "A" }, "one"), tab({ id: "b", name: "B" }, "two")];
    expect(shown(stateOf(content))).toBe("A");
    expect(shown(stateOf(content, "b"))).toBe("B");
    expect(shown(stateOf(content, "missing"))).toBe("A");
  });

  it("hides the other tabs with a decoration", () => {
    const state = stateOf([tab({ id: "a" }, "one"), tab({ id: "b" }, "two")]);
    const decorations = documentTabsKey.getState(state)!.decorations.find();
    expect(decorations.map((decoration) => [decoration.from, (decoration as unknown as { type: { attrs: object } }).type.attrs])).toEqual([
      [findTab(state.doc, "b")!.pos, { class: "is-hidden-tab" }],
    ]);
  });

  it("keeps the selection in the shown tab: select all selects the tab's content", () => {
    const state = stateOf([tab({ id: "a" }, "one"), tab({ id: "b" }, "two")], "b");
    const all = dispatch(state, selectAll);
    expect(all.doc.textBetween(all.selection.from, all.selection.to)).toBe("two");
    // Deleting it leaves the other tab alone.
    const deleted = dispatch(all, deleteSelection);
    expect(documentTabs(deleted.doc).map((entry) => entry.node.textContent)).toEqual(["one", ""]);
  });

  it("moves a selection set in a hidden tab back into the shown one", () => {
    const state = stateOf([tab({ id: "a" }, "one"), tab({ id: "b" }, "two")]);
    const b = findTab(state.doc, "b")!;
    const next = state.applyTransaction(state.tr.setSelection(TextSelection.create(state.doc, b.from + 2))).state;
    expect(currentTab(next).id).toBe("a");
    expect(next.selection.head).toBeLessThanOrEqual(findTab(next.doc, "a")!.to);
  });

  it("never joins two tabs with Backspace at the start of a tab", () => {
    let state = stateOf([tab({ id: "a" }, "one"), tab({ id: "b" }, "two")], "b");
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, findTab(state.doc, "b")!.from + 1)));
    expect(joinBackward(state, () => {})).toBe(false);
  });

  it("follows undo and redo into the tab they change", () => {
    let state = stateOf([tab({ id: "a" }, "one"), tab({ id: "b" }, "two")]);
    state = state.apply(state.tr.insertText("!", findTab(state.doc, "a")!.to - 1));
    state = run(state, (current) => switchTab(current, "b"));
    expect(shown(state)).toBe("b");
    state = dispatch(state, undo);
    expect(shown(state)).toBe("a");
    expect(findTab(state.doc, "a")!.node.textContent).toBe("one");
    state = run(state, (current) => switchTab(current, "b"));
    state = dispatch(state, redo);
    expect(shown(state)).toBe("a");
  });

  it("restores a remembered selection when switching back", () => {
    let state = stateOf([tab({ id: "a" }, "hello world"), tab({ id: "b" }, "two")]);
    state = run(state, (current) => switchTab(current, "a", { anchor: 3, head: 6 }));
    expect(state.doc.textBetween(state.selection.from, state.selection.to)).toBe("llo");
  });
});

describe("Find and word count", () => {
  it("search and count the shown tab", () => {
    let state = stateOf([tab({ id: "a" }, "cat and cat"), tab({ id: "b" }, "cat dog")]);
    state = state.apply(setSearch(state.tr, { ...defaultSearchOptions, query: "cat" }));
    expect(getSearchState(state).matches).toHaveLength(2);
    expect(documentStats(state).total.words).toBe(3);
    state = run(state, (current) => switchTab(current, "b"));
    expect(getSearchState(state).matches).toHaveLength(1);
    expect(documentStats(state).total.words).toBe(2);
  });
});

describe("sidebar commands", () => {
  const old = () => stateOf([paragraph("old text")]);

  it("Add tab: Tab 2 after the current tab, shown, empty, with the cursor at its start; a document from before tabs gets its tab node", () => {
    const state = run(old(), (current) => addTab(current, FIRST_TAB_ID));
    expect(names(state)).toEqual(["Tab 1", "Tab 2"]);
    expect(shown(state)).toBe("Tab 2");
    expect(currentTab(state).node.textContent).toBe("");
    expect(state.selection.from).toBe(currentTab(state).from + 1);
    expect(findTab(state.doc, FIRST_TAB_ID)!.node.textContent).toBe("old text");
    // One undo step.
    expect(dispatch(state, undo).doc.eq(old().doc)).toBe(true);
  });

  it("names new tabs with the next free number", () => {
    const state = stateOf([tab({ id: "a", name: "Tab 1" }), tab({ id: "b", name: "Tab 3" })].map((json) => ({ ...json, content: [paragraph("")] })));
    expect(nextTabName(state.doc)).toBe("Tab 4");
    expect(nextTabName(stateOf([tab({ id: "a", name: "Tab 2" }, "")]).doc)).toBe("Tab 3");
  });

  it("Add subtab nests up to three levels", () => {
    let state = run(old(), (current) => addSubtab(current, FIRST_TAB_ID));
    const second = currentTab(state).id;
    state = run(state, (current) => addSubtab(current, second));
    expect(names(state)).toEqual(["Tab 1", "  Tab 2", "    Tab 3"]);
    expect(canAddSubtab(state.doc, currentTab(state).id)).toBe(false);
    expect(addSubtab(state, currentTab(state).id)).toBeNull();
  });

  it("Delete removes a tab with its subtabs and shows the tab before it, but not the last tab", () => {
    expect(deleteTab(old(), FIRST_TAB_ID)).toBeNull();
    let state = run(old(), (current) => addTab(current, FIRST_TAB_ID));
    const second = currentTab(state).id;
    state = run(state, (current) => addSubtab(current, second));
    state = run(state, (current) => addTab(current, second));
    expect(names(state)).toEqual(["Tab 1", "Tab 2", "  Tab 3", "Tab 4"]);
    state = run(state, (current) => switchTab(current, second));
    state = run(state, (current) => deleteTab(current, second));
    expect(names(state)).toEqual(["Tab 1", "Tab 4"]);
    expect(shown(state)).toBe("Tab 1");
  });

  it("Duplicate adds Copy of <name> after the tab, with its content and new suggestion ids", () => {
    const suggested = {
      type: "paragraph",
      content: [{ type: "text", text: "new", marks: [{ type: "suggestionInsert", attrs: { id: "s1", author: "You", createdAt: 1 } }] }],
    };
    let state = stateOf([{ type: "documentTab", attrs: { id: "a", name: "Plan" }, content: [suggested] }, tab({ id: "b", name: "Other", order: 1 }, "x")]);
    state = run(state, (current) => duplicateTab(current, "a"));
    expect(names(state)).toEqual(["Plan", "Copy of Plan", "Other"]);
    expect(currentTab(state).node.textContent).toBe("new");
    expect(JSON.stringify(currentTab(state).node.toJSON())).not.toContain('"s1"');
  });

  it("Rename, Choose emoji, Remove emoji and Show outline set the tab's attributes", () => {
    let state = run(old(), (current) => setTabAttribute(current, FIRST_TAB_ID, "name", "Intro"));
    state = run(state, (current) => setTabAttribute(current, FIRST_TAB_ID, "emoji", "🚀"));
    state = run(state, (current) => setTabAttribute(current, FIRST_TAB_ID, "showOutline", true));
    expect(findTab(state.doc, FIRST_TAB_ID)).toMatchObject({ name: "Intro", emoji: "🚀", showOutline: true });
    state = run(state, (current) => setTabAttribute(current, FIRST_TAB_ID, "emoji", null));
    expect(findTab(state.doc, FIRST_TAB_ID)!.emoji).toBeNull();
  });

  it("Move up and Move down swap a tab (with its subtabs) with the one next to it, without moving content", () => {
    let state = run(old(), (current) => addTab(current, FIRST_TAB_ID));
    const second = currentTab(state).id;
    state = run(state, (current) => addSubtab(current, second));
    expect(canMoveTab(state.doc, FIRST_TAB_ID, -1)).toBe(false);
    const before = state.doc;
    state = run(state, (current) => moveTab(current, second, -1));
    expect(names(state)).toEqual(["Tab 2", "  Tab 3", "Tab 1"]);
    // Only attributes changed: every tab's content is where it was.
    expect(documentTabs(state.doc).map((entry) => entry.from)).toEqual(documentTabs(before).map((entry) => entry.from));
    state = run(state, (current) => moveTab(current, second, 1));
    expect(names(state)).toEqual(["Tab 1", "Tab 2", "  Tab 3"]);
  });

  it("Move into nests a tab under another top-level tab, or moves it to the top level", () => {
    let state = run(old(), (current) => addTab(current, FIRST_TAB_ID));
    const second = currentTab(state).id;
    state = run(state, (current) => addTab(current, second));
    const third = currentTab(state).id;
    expect(moveTargets(state.doc, third).tabs.map((entry) => entry.name)).toEqual(["Tab 1", "Tab 2"]);
    expect(moveTargets(state.doc, third).topLevel).toBe(false);
    state = run(state, (current) => moveTabInto(current, third, FIRST_TAB_ID));
    expect(names(state)).toEqual(["Tab 1", "  Tab 3", "Tab 2"]);
    state = run(state, (current) => moveTabInto(current, third, null));
    expect(names(state)).toEqual(["Tab 1", "Tab 3", "Tab 2"]);
    // A tab with two levels of subtabs fits nowhere else.
    state = run(state, (current) => addSubtab(current, second));
    state = run(state, (current) => addSubtab(current, currentTab(current).id));
    expect(moveTargets(state.doc, second).tabs).toEqual([]);
  });
});
