// Document tabs in the editor (docs/design/document-tabs.md): which tab is shown, hiding the
// others, keeping the selection in the shown tab, and the commands of the tabs sidebar.
import {
  copyTabContent,
  documentTabs,
  DOCUMENT_TAB,
  findTab,
  firstTab,
  hasTabNodes,
  MAX_TAB_DEPTH,
  newTabId,
  subtreeIds,
  tabAtPos,
  tabTree,
  wrapInTab,
  type DocTab,
  type TabEntry,
} from "@docs/shared";
import { Extension, type JSONContent } from "@tiptap/core";
import { closeHistory } from "./tabHistory.ts";
import { Fragment, Slice, type Node } from "@tiptap/pm/model";
import { AllSelection, Plugin, PluginKey, Selection, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

type TabsState = { currentId: string; decorations: DecorationSet };
type TabsMeta = { switchTo: string };

export const documentTabsKey = new PluginKey<TabsState>("documentTabs");

/** The tab the editor shows. */
export function currentTab(state: EditorState): DocTab {
  const id = documentTabsKey.getState(state)?.currentId;
  return (id !== undefined && findTab(state.doc, id)) || firstTab(state.doc);
}

export function currentTabId(state: EditorState): string {
  return currentTab(state).id;
}

/** Marks a transaction as switching to tab `id`. */
export function setCurrentTab(tr: Transaction, id: string): Transaction {
  return tr.setMeta(documentTabsKey, { switchTo: id } satisfies TabsMeta);
}

export const DocumentTabs = Extension.create<{ initialTab: string | null }>({
  name: "documentTabs",
  // First among the plugins, so the others (search, pagination) read the shown tab of the new state.
  priority: 1000,
  addOptions: () => ({ initialTab: null }),

  addProseMirrorPlugins() {
    const { initialTab } = this.options;
    return [
      new Plugin<TabsState>({
        key: documentTabsKey,
        state: {
          init: (_config, state) => {
            const currentId = initialTab !== null && findTab(state.doc, initialTab) ? initialTab : firstTab(state.doc).id;
            return { currentId, decorations: hiddenTabs(state.doc, currentId) };
          },
          apply(tr, value) {
            const meta = tr.getMeta(documentTabsKey) as TabsMeta | undefined;
            if (!meta && !tr.docChanged) return value;
            let currentId = meta?.switchTo ?? value.currentId;
            // The shown tab was deleted (or a deletion undone): show the tab with the selection.
            if (!findTab(tr.doc, currentId)) currentId = (tabAtPos(tr.doc, tr.selection.head) ?? firstTab(tr.doc)).id;
            const sameTabs = currentId === value.currentId && documentTabs(tr.before).length === documentTabs(tr.doc).length;
            return {
              currentId,
              decorations: sameTabs ? value.decorations.map(tr.mapping, tr.doc) : hiddenTabs(tr.doc, currentId),
            };
          },
        },
        props: {
          decorations: (state) => documentTabsKey.getState(state)!.decorations,
          // Copied content carries its tab as context; pasted, it is just the blocks.
          transformPasted: (slice) => unwrapTabs(slice),
        },
        appendTransaction(transactions, _oldState, state) {
          if (!hasTabNodes(state.doc)) return null;
          const tab = currentTab(state);
          const { selection } = state;
          // Undo and redo can change another tab: show the tab they changed, with the cursor there.
          const changed = historyChange(transactions);
          const changedTab = changed === null ? null : tabAtPos(state.doc, changed);
          if (changedTab && changedTab.id !== tab.id) {
            const inTab = selection.from >= changedTab.from && selection.to <= changedTab.to;
            const target = inTab ? selection : Selection.near(state.doc.resolve(changed!));
            return setCurrentTab(state.tr.setSelection(selectionIn(state.doc, changedTab, target)).scrollIntoView(), changedTab.id);
          }
          if (!(selection instanceof AllSelection) && selection.from >= tab.from && selection.to <= tab.to) return null;
          return state.tr.setSelection(selectionIn(state.doc, tab, selection));
        },
      }),
    ];
  },
});

/** The first position an undo or redo among `transactions` changed, in the last one's document; null if none did. */
function historyChange(transactions: readonly Transaction[]): number | null {
  let result: number | null = null;
  transactions.forEach((tr, index) => {
    if (!tr.getMeta("history$") || !tr.docChanged) return;
    const { maps } = tr.mapping;
    maps.forEach((map, mapIndex) => {
      const rest = tr.mapping.slice(mapIndex + 1);
      map.forEach((_oldStart, _oldEnd, start) => {
        let pos = rest.map(start);
        for (const later of transactions.slice(index + 1)) pos = later.mapping.map(pos);
        if (result === null || pos < result) result = pos;
      });
    });
  });
  return result;
}

/** Hides every tab but the shown one. */
function hiddenTabs(doc: Node, currentId: string): DecorationSet {
  if (!hasTabNodes(doc)) return DecorationSet.empty;
  const decorations = documentTabs(doc)
    .filter((tab) => tab.id !== currentId)
    .map((tab) => Decoration.node(tab.pos!, tab.pos! + tab.node.nodeSize, { class: "is-hidden-tab" }));
  return DecorationSet.create(doc, decorations);
}

/** `selection` limited to the content of `tab` (select all selects the tab's content). */
export function selectionIn(doc: Node, tab: DocTab, selection: Selection): Selection {
  const clamp = (pos: number) => Math.min(Math.max(pos, tab.from), tab.to);
  const inside = (candidate: Selection | null) => candidate !== null && candidate.from >= tab.from && candidate.to <= tab.to;
  if (selection instanceof AllSelection) {
    const all = TextSelection.between(doc.resolve(tab.from), doc.resolve(tab.to));
    if (inside(all)) return all;
  } else {
    const anchor = clamp(selection.anchor);
    const head = clamp(selection.head);
    // Searching towards the inside of the tab, so the selection never lands in the next one.
    const $head = doc.resolve(head);
    const result =
      anchor !== head
        ? TextSelection.between(doc.resolve(anchor), $head)
        : head >= tab.to
          ? Selection.findFrom($head, -1)
          : Selection.findFrom($head, 1) ?? Selection.findFrom($head, -1);
    if (inside(result)) return result!;
  }
  const start = Selection.findFrom(doc.resolve(tab.from), 1);
  return inside(start) ? start! : TextSelection.create(doc, tab.from);
}

function unwrapTabs(slice: Slice): Slice {
  let hasTabs = false;
  slice.content.forEach((node) => {
    if (node.type.name === DOCUMENT_TAB) hasTabs = true;
  });
  if (!hasTabs) return slice;
  const blocks: Node[] = [];
  slice.content.forEach((node) => (node.type.name === DOCUMENT_TAB ? node.forEach((block) => blocks.push(block)) : blocks.push(node)));
  return new Slice(Fragment.from(blocks), Math.max(0, slice.openStart - 1), Math.max(0, slice.openEnd - 1));
}

// ---------------------------------------------------------------------------------------------
// Sidebar commands. Each returns a transaction (one undo step) or null when it is not possible.
// A document without tab nodes gets its tab node first (wrapInTab). Tab nodes are added at the
// end of the document and never moved: their place in the sidebar is the `order` and `parentId`
// attributes, which `arrange` sets.

/** The sidebar's tree: each tab with its subtabs. */
type Branch = { id: string; children: Branch[] };

function branches(doc: Node): Branch[] {
  const roots: Branch[] = [];
  const stack: Branch[] = [];
  for (const entry of tabTree(doc)) {
    const branch = { id: entry.id, children: [] };
    stack.length = entry.depth;
    (stack.at(-1)?.children ?? roots).push(branch);
    stack.push(branch);
  }
  return roots;
}

/** The list that holds tab `id` and its index there. */
function locate(roots: Branch[], id: string): { list: Branch[]; index: number; parent: string | null } | null {
  const search = (list: Branch[], parent: string | null): ReturnType<typeof locate> => {
    for (const [index, branch] of list.entries()) {
      if (branch.id === id) return { list, index, parent };
      const found = search(branch.children, branch.id);
      if (found) return found;
    }
    return null;
  };
  return search(roots, null);
}

/** Sets every tab's `order` (its place in the sidebar) and `parentId` from the tree. */
function arrange(tr: Transaction, roots: Branch[]): Transaction {
  let order = 0;
  const visit = (list: Branch[], parentId: string | null) => {
    for (const branch of list) {
      const tab = findTab(tr.doc, branch.id);
      if (tab?.pos !== null && tab !== undefined) {
        if (tab.order !== order) tr.setNodeAttribute(tab.pos, "order", order);
        if (tab.parentId !== parentId) tr.setNodeAttribute(tab.pos, "parentId", parentId);
      }
      order += 1;
      visit(branch.children, branch.id);
    }
  };
  visit(roots, null);
  return tr;
}

/** A transaction that starts a new undo step, on a document with tab nodes. */
function tabTransaction(state: EditorState): Transaction {
  const tr = state.tr;
  closeHistory(tr);
  wrapInTab(tr);
  return tr;
}

/** "Tab N": the number of tabs plus one, or the next number not in use. */
export function nextTabName(doc: Node): string {
  const names = new Set(documentTabs(doc).map((tab) => tab.name));
  let number = documentTabs(doc).length + 1;
  while (names.has(`Tab ${number}`)) number += 1;
  return `Tab ${number}`;
}

/** Adds a tab node at the end of the document and returns its id. */
function appendTab(tr: Transaction, name: string, content?: JSONContent[]): string {
  const id = newTabId();
  const { schema } = tr.doc.type;
  const blocks = content && content.length > 0 ? Fragment.fromJSON(schema, content) : Fragment.from(schema.nodes.paragraph!.create());
  tr.insert(tr.doc.content.size, schema.nodes[DOCUMENT_TAB]!.create({ id, name }, blocks));
  return id;
}

/** Shows tab `id` with the cursor at its start. */
function showNewTab(tr: Transaction, id: string): Transaction {
  const tab = findTab(tr.doc, id)!;
  return setCurrentTab(tr.setSelection(Selection.near(tr.doc.resolve(tab.from))), id).scrollIntoView();
}

/** Add tab (+): "Tab N" after tab `afterId` (and its subtabs), at its level; switches to it. */
export function addTab(state: EditorState, afterId: string): Transaction {
  const tr = tabTransaction(state);
  const roots = branches(tr.doc);
  const id = appendTab(tr, nextTabName(state.doc));
  const place = locate(roots, afterId);
  if (place) place.list.splice(place.index + 1, 0, { id, children: [] });
  else roots.push({ id, children: [] });
  return showNewTab(arrange(tr, roots), id);
}

/** Whether tab `id` can have subtabs: it is not at the deepest level. */
export function canAddSubtab(doc: Node, id: string): boolean {
  const entry = tabTree(doc).find((candidate) => candidate.id === id);
  return entry !== undefined && entry.depth < MAX_TAB_DEPTH - 1;
}

/** Add subtab: a new last subtab of tab `parentId`; switches to it. */
export function addSubtab(state: EditorState, parentId: string): Transaction | null {
  if (!canAddSubtab(state.doc, parentId)) return null;
  const tr = tabTransaction(state);
  const roots = branches(tr.doc);
  const id = appendTab(tr, nextTabName(state.doc));
  const place = locate(roots, parentId)!;
  place.list[place.index]!.children.push({ id, children: [] });
  return showNewTab(arrange(tr, roots), id);
}

/** Delete: tab `id` and its subtabs. Not possible for the last tab. */
export function deleteTab(state: EditorState, id: string): Transaction | null {
  const doc = state.doc;
  const removed = new Set(subtreeIds(doc, id));
  const remaining = tabTree(doc).filter((entry) => !removed.has(entry.id));
  if (removed.size === 0 || remaining.length === 0) return null;
  const tr = tabTransaction(state);
  const shown = currentTabId(state);
  // Shown next: the tab before the deleted one in the sidebar, or else the one after it.
  const tree = tabTree(doc);
  const index = tree.findIndex((entry) => entry.id === id);
  const next = [...tree.slice(0, index)].reverse().find((entry) => !removed.has(entry.id)) ?? remaining[0]!;
  const nodes = documentTabs(tr.doc).filter((tab) => removed.has(tab.id));
  for (const tab of nodes.reverse()) tr.delete(tab.pos!, tab.pos! + tab.node.nodeSize);
  if (!removed.has(shown)) return tr;
  return showNewTab(tr, next.id);
}

/** Duplicate: "Copy of <name>" with the same content (not its subtabs) right after it; switches to it. */
export function duplicateTab(state: EditorState, id: string): Transaction | null {
  const source = findTab(state.doc, id);
  if (!source) return null;
  const tr = tabTransaction(state);
  const roots = branches(tr.doc);
  const content = copyTabContent((source.node.content.toJSON() as JSONContent[] | null) ?? [], newSuggestionId);
  const copyId = appendTab(tr, `Copy of ${source.name}`.slice(0, 100), content);
  const place = locate(roots, id);
  if (place) place.list.splice(place.index + 1, 0, { id: copyId, children: [] });
  const emoji = source.emoji;
  if (emoji) tr.setNodeAttribute(findTab(tr.doc, copyId)!.pos!, "emoji", emoji);
  return showNewTab(arrange(tr, roots), copyId);
}

function newSuggestionId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Sets an attribute of tab `id` (Rename, Choose emoji, Show outline). */
export function setTabAttribute(state: EditorState, id: string, key: "name" | "emoji" | "showOutline", value: unknown): Transaction | null {
  const tab = findTab(state.doc, id);
  if (!tab || tab[key] === value) return null;
  const tr = tabTransaction(state);
  return tr.setNodeAttribute(findTab(tr.doc, id)!.pos!, key, value);
}

/** Whether Move up (-1) or Move down (1) is possible: there is a tab at the same level that way. */
export function canMoveTab(doc: Node, id: string, direction: -1 | 1): boolean {
  const place = locate(branches(doc), id);
  return place !== null && place.list[place.index + direction] !== undefined;
}

/** Move up or Move down among the tabs at the same level, with its subtabs. */
export function moveTab(state: EditorState, id: string, direction: -1 | 1): Transaction | null {
  if (!canMoveTab(state.doc, id, direction)) return null;
  const tr = tabTransaction(state);
  const roots = branches(tr.doc);
  const { list, index } = locate(roots, id)!;
  [list[index], list[index + direction]] = [list[index + direction]!, list[index]!];
  return arrange(tr, roots);
}

/** Levels tab `id` and its subtabs take up (1 for a tab without subtabs). */
function levels(entries: TabEntry[], id: string): number {
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry) return 0;
  return 1 + Math.max(0, ...entry.childIds.map((child) => levels(entries, child)));
}

/** The tabs Move into ▸ lists for tab `id`: other top-level tabs it fits under, and whether "Top level" applies. */
export function moveTargets(doc: Node, id: string): { tabs: TabEntry[]; topLevel: boolean } {
  const entries = tabTree(doc);
  const entry = entries.find((candidate) => candidate.id === id);
  const fits = levels(entries, id) + 1 <= MAX_TAB_DEPTH;
  const tabs = fits ? entries.filter((candidate) => candidate.depth === 0 && candidate.id !== id && candidate.id !== entry?.parent) : [];
  return { tabs, topLevel: entry !== undefined && entry.depth > 0 };
}

/** Move into: makes tab `id` the last subtab of `parentId`, or a top-level tab after its top-level ancestor (null). */
export function moveTabInto(state: EditorState, id: string, parentId: string | null): Transaction | null {
  const targets = moveTargets(state.doc, id);
  if (parentId === null ? !targets.topLevel : !targets.tabs.some((tab) => tab.id === parentId)) return null;
  const tr = tabTransaction(state);
  const roots = branches(tr.doc);
  const place = locate(roots, id)!;
  const [branch] = place.list.splice(place.index, 1);
  if (parentId === null) {
    const ancestor = roots.findIndex((root) => root.id === id || subtreeIds(state.doc, root.id).includes(id));
    roots.splice(ancestor + 1, 0, branch!);
  } else {
    locate(roots, parentId)!.list.find((candidate) => candidate.id === parentId)!.children.push(branch!);
  }
  return arrange(tr, roots);
}

/** Switches to tab `id`, with `selection` (an offset range in the tab's content) or the cursor at its start. */
export function switchTab(state: EditorState, id: string, selection?: { anchor: number; head: number }): Transaction | null {
  const tab = findTab(state.doc, id);
  if (!tab) return null;
  const tr = setCurrentTab(state.tr, id);
  const inTab = (offset: number) => Math.min(tab.from + offset, tab.to);
  const restored = selection
    ? TextSelection.between(tr.doc.resolve(inTab(selection.anchor)), tr.doc.resolve(inTab(selection.head)))
    : Selection.near(tr.doc.resolve(tab.from));
  return tr.setSelection(selectionIn(tr.doc, tab, restored));
}

/** The element of the shown tab (the editor's element for a document without tab nodes). */
export function shownTabElement(view: EditorView): HTMLElement {
  const tab = currentTab(view.state);
  const element = tab.pos === null ? null : view.nodeDOM(tab.pos);
  return element instanceof HTMLElement ? element : view.dom;
}
