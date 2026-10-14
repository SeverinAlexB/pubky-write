// Document tabs (docs/spec/18-document-tabs.md, docs/design/document-tabs.md).
//
// A document's content is either blocks (one tab, as every document was before tabs existed) or
// `documentTab` nodes, each holding the blocks of one tab. A document gets its tab nodes the first
// time a tab command needs them (`wrapInTab`), as an ordinary ReplaceAroundStep, so stored
// documents, stored steps and old versions stay valid. Every reader goes through `documentTabs`,
// which describes a document without tab nodes as one tab "Tab 1" covering the whole content.
//
// Tab nodes are never moved: the order in the sidebar is the `order` attribute and nesting the
// `parentId` attribute, so moving a tab changes attributes only and comment anchors stay put.
import { Node as TiptapNode, type JSONContent } from "@tiptap/core";
import { Fragment, Slice, type Node } from "@tiptap/pm/model";
import { ReplaceAroundStep, type Transform } from "@tiptap/pm/transform";

export const DOCUMENT_TAB = "documentTab";
/** Id of the tab a document without tab nodes has, kept when it is wrapped in its tab node. */
export const FIRST_TAB_ID = "t.0";
export const FIRST_TAB_NAME = "Tab 1";
/** Tabs nest up to this many levels: a tab, its subtabs and theirs. */
export const MAX_TAB_DEPTH = 3;
export const MAX_TAB_NAME_LENGTH = 100;

const TAB_ID = /^[\w.-]{1,40}$/;

export type TabAttrs = {
  id: string;
  name: string;
  /** Shown instead of the document icon; null for none. */
  emoji: string | null;
  /** The tab this one is nested under, or null at the top level. */
  parentId: string | null;
  /** Position in the sidebar among all tabs (pre-order); ties keep document order. */
  order: number;
  /** "Show outline": the outline is listed under the tab even when it is not the current tab. */
  showOutline: boolean;
};

export type DocTab = TabAttrs & {
  /** Position of the tab node, or null for the one tab of a document without tab nodes. */
  pos: number | null;
  /** The tab node, or the document itself when it has no tab nodes. */
  node: Node;
  /** Start and end of the tab's content (its blocks). */
  from: number;
  to: number;
};

/** A tab in sidebar order with its nesting depth (0 at the top level) and resolved parent. */
export type TabEntry = DocTab & { depth: number; parent: string | null; childIds: string[] };

export function isTabId(value: unknown): value is string {
  return typeof value === "string" && TAB_ID.test(value);
}

export function newTabId(): string {
  return `t.${Math.random().toString(36).slice(2, 10)}`;
}

/** The node of one tab. Isolating, so Backspace and Delete at a tab's edge never join two tabs. */
export const DocumentTab = TiptapNode.create({
  name: DOCUMENT_TAB,
  content: "block+",
  isolating: true,
  selectable: false,
  draggable: false,

  addAttributes() {
    const text = (name: string, validate: (value: unknown) => boolean) => ({
      rendered: false,
      validate: (value: unknown) => {
        if (!validate(value)) throw new RangeError(`Invalid tab ${name} ${JSON.stringify(value)}`);
      },
    });
    return {
      // Required: ProseMirror never makes a tab node by itself (to fit pasted content, for example).
      id: { ...text("id", isTabId), isRequired: true },
      name: {
        default: FIRST_TAB_NAME,
        ...text("name", (value) => typeof value === "string" && value.trim().length > 0 && value.length <= MAX_TAB_NAME_LENGTH),
      },
      emoji: { default: null, ...text("emoji", (value) => value === null || (typeof value === "string" && value.length > 0 && value.length <= 16)) },
      parentId: { default: null, ...text("parent", (value) => value === null || isTabId(value)) },
      order: {
        default: 0,
        ...text("order", (value) => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100_000),
      },
      showOutline: { default: false, ...text("showOutline", (value) => typeof value === "boolean") },
    };
  },

  parseHTML() {
    // Only the editor's own DOM: pasted HTML never makes tabs (see the clipboard handling in the editor).
    return [{ tag: "div[data-document-tab]", getAttrs: (element) => (isTabId(element.dataset.documentTab) ? { id: element.dataset.documentTab } : false) }];
  },

  renderHTML({ node }) {
    return ["div", { class: "document-tab", "data-document-tab": node.attrs.id }, 0];
  },
});

const tabLists = new WeakMap<Node, DocTab[]>();

/** The document's tabs in document order. A document without tab nodes has one. */
export function documentTabs(doc: Node): DocTab[] {
  let tabs = tabLists.get(doc);
  if (tabs) return tabs;
  if (!hasTabNodes(doc)) {
    tabs = [
      {
        id: FIRST_TAB_ID,
        name: FIRST_TAB_NAME,
        emoji: null,
        parentId: null,
        order: 0,
        showOutline: false,
        pos: null,
        node: doc,
        from: 0,
        to: doc.content.size,
      },
    ];
  } else {
    const list: DocTab[] = [];
    doc.forEach((node, pos) => {
      list.push({ ...(node.attrs as TabAttrs), pos, node, from: pos + 1, to: pos + node.nodeSize - 1 });
    });
    tabs = list;
  }
  tabLists.set(doc, tabs);
  return tabs;
}

export function hasTabNodes(doc: Node): boolean {
  return doc.firstChild?.type.name === DOCUMENT_TAB;
}

export function findTab(doc: Node, id: string): DocTab | undefined {
  return documentTabs(doc).find((tab) => tab.id === id);
}

/** The tab whose content contains `pos`, or null for a position between two tab nodes. */
export function tabAtPos(doc: Node, pos: number): DocTab | null {
  return documentTabs(doc).find((tab) => pos >= tab.from && pos <= tab.to) ?? null;
}

const trees = new WeakMap<Node, TabEntry[]>();

/**
 * The tabs in sidebar order: sorted by `order`, children after their parent. A parent that is
 * missing, would make a cycle or nest deeper than MAX_TAB_DEPTH puts the tab at the top level.
 */
export function tabTree(doc: Node): TabEntry[] {
  const cached = trees.get(doc);
  if (cached) return cached;
  const tabs = documentTabs(doc);
  const sorted = tabs.map((tab, index) => ({ tab, index })).sort((a, b) => a.tab.order - b.tab.order || a.index - b.index);
  const byId = new Map(tabs.map((tab) => [tab.id, tab]));
  const depthOf = new Map<string, number>();
  const parentOf = (tab: DocTab): string | null => {
    // Walk up to the top; a missing tab ends the chain.
    const seen = new Set([tab.id]);
    let ancestors = 0;
    for (let id = tab.parentId; id !== null && byId.has(id); id = byId.get(id)!.parentId) {
      if (seen.has(id)) return null; // a cycle
      seen.add(id);
      ancestors += 1;
    }
    return ancestors > 0 && ancestors < MAX_TAB_DEPTH ? tab.parentId : null;
  };
  const children = new Map<string | null, DocTab[]>();
  for (const { tab } of sorted) {
    const parent = parentOf(tab);
    children.set(parent, [...(children.get(parent) ?? []), tab]);
  }
  const result: TabEntry[] = [];
  const visit = (parent: string | null, depth: number) => {
    for (const tab of children.get(parent) ?? []) {
      depthOf.set(tab.id, depth);
      result.push({ ...tab, depth, parent, childIds: (children.get(tab.id) ?? []).map((child) => child.id) });
      // Deeper levels than allowed were made top-level above, so this stays within MAX_TAB_DEPTH.
      visit(tab.id, depth + 1);
    }
  };
  visit(null, 0);
  // Tabs only reachable through a cycle were left out above; list them at the top level.
  for (const { tab } of sorted) {
    if (!depthOf.has(tab.id)) result.push({ ...tab, depth: 0, parent: null, childIds: [] });
  }
  trees.set(doc, result);
  return result;
}

/** The first tab in the sidebar: the one the document list's thumbnail shows. */
export function firstTab(doc: Node): DocTab {
  return tabTree(doc)[0] ?? documentTabs(doc)[0]!;
}

/** The ids of `id` and every tab nested under it, in sidebar order. */
export function subtreeIds(doc: Node, id: string): string[] {
  const tree = tabTree(doc);
  const index = tree.findIndex((entry) => entry.id === id);
  if (index < 0) return [];
  const ids = [id];
  for (let next = index + 1; next < tree.length && tree[next]!.depth > tree[index]!.depth; next++) ids.push(tree[next]!.id);
  return ids;
}

/**
 * Gives a document without tab nodes its one tab node ("Tab 1"), as a ReplaceAroundStep that
 * moves every position by one. Does nothing for a document that has tab nodes.
 */
export function wrapInTab(tr: Transform): Transform {
  const { doc } = tr;
  if (hasTabNodes(doc)) return tr;
  const tab = doc.type.schema.nodes[DOCUMENT_TAB]!.create({ id: FIRST_TAB_ID, name: FIRST_TAB_NAME });
  const size = doc.content.size;
  return tr.step(new ReplaceAroundStep(0, size, 0, size, new Slice(Fragment.from(tab), 0, 0), 1, true));
}

/**
 * The document with the content of one tab (by id), or of all tabs in sidebar order, as plain
 * blocks, for exports and thumbnails. With all tabs each tab starts on a new page with its name
 * as a Heading 1. The page setup, headers and footers are kept.
 */
export function tabsDocument(doc: Node, which: string | "all"): Node {
  const tabs = tabTree(doc);
  if (which !== "all") {
    const tab = tabs.find((candidate) => candidate.id === which) ?? firstTab(doc);
    return tab.pos === null ? doc : doc.copy(tab.node.content);
  }
  const { schema } = doc.type;
  const blocks: Node[] = [];
  tabs.forEach((tab, index) => {
    if (index > 0) blocks.push(schema.nodes.pageBreak!.create());
    blocks.push(schema.nodes.heading!.create({ level: 1 }, schema.text(tab.name)));
    tab.node.forEach((block) => blocks.push(block));
  });
  return doc.copy(Fragment.from(blocks));
}

/**
 * A copy of a tab's content for Duplicate, with new ids for the suggestions in it: one
 * suggestion's parts share an id, so the copy's must not be joined with the original's.
 */
export function copyTabContent(content: JSONContent[], newId: () => string): JSONContent[] {
  const ids = new Map<string, string>();
  const mapped = (id: unknown) => {
    if (typeof id !== "string") return id;
    if (!ids.has(id)) ids.set(id, newId());
    return ids.get(id)!;
  };
  const withId = (value: unknown) =>
    value && typeof value === "object" && "id" in value ? { ...(value as Record<string, unknown>), id: mapped((value as { id: unknown }).id) } : value;
  const copy = (node: JSONContent): JSONContent => {
    const result: JSONContent = { ...node };
    if (node.attrs) {
      for (const name of ["suggestionFormat", "suggestionBreak", "suggestionInsert", "suggestionDelete"]) {
        if (node.attrs[name]) result.attrs = { ...(result.attrs ?? node.attrs), [name]: withId(node.attrs[name]) };
      }
      // A footnote's text.
      if (node.type === "footnote" && Array.isArray(node.attrs.content)) {
        result.attrs = { ...(result.attrs ?? node.attrs), content: (node.attrs.content as JSONContent[]).map(copy) };
      }
    }
    if (node.marks) {
      result.marks = node.marks.map((mark) => (mark.type.startsWith("suggestion") && mark.attrs ? { ...mark, attrs: withId(mark.attrs) as Record<string, unknown> } : mark));
    }
    if (node.content) result.content = node.content.map(copy);
    return result;
  };
  return content.map(copy);
}
