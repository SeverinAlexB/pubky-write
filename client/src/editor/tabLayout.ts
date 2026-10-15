// Lays out tab characters: each `.tab-char` gets the width that takes the text after it to the
// next tab stop of its paragraph (see tabAdvance in shared/src/tabStops.ts). Positions count from
// the left margin: the content edge of the closest `.page-content` (or table cell).
//
// A tab's position depends on the tabs before it on its line, so the tabs of a paragraph are laid
// out one after another. To keep the number of layouts small, the n-th tab of every paragraph is
// measured in the same round: one browser layout per round, as many rounds as the paragraph with
// the most tabs has tabs.
import { decodeTabStops, PX_PER_PT, tabAdvance, type TabStop } from "@docs/shared";
import { Extension, type Editor } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { Plugin, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { currentTab, shownTabElement } from "./documentTabs.ts";
import { clientRect } from "./rects.ts";

const TAB_SELECTOR = ".tab-char";
const TEXTBLOCK_SELECTOR = "p, h1, h2, h3, h4, h5, h6";

type ParagraphTabs = {
  paragraph: HTMLElement;
  tabs: HTMLElement[];
  stops: TabStop[];
  /** Screen pixels per CSS pixel (the editor's zoom). */
  zoom: number;
  /** Client x of the left margin, the left indent and the end of the line. */
  originX: number;
  indentX: number;
  lineEndX: number;
};

/** The client x where `element`'s content box starts and ends. */
function contentEdges(element: HTMLElement, zoom: number): { left: number; right: number } {
  const rect = clientRect(element);
  const style = getComputedStyle(element);
  const inset = (side: "Left" | "Right") =>
    ((Number.parseFloat(style[`padding${side}`]) || 0) + (Number.parseFloat(style[`border${side}Width`]) || 0)) * zoom;
  return { left: rect.left + inset("Left"), right: rect.right - inset("Right") };
}

/**
 * The left edge tab positions count from: the content edge of the page (or cell), or with columns
 * (Format > Columns) the left edge of the paragraph's column.
 */
function columnOrigin(origin: HTMLElement, paragraphLeft: number, zoom: number): number {
  const left = contentEdges(origin, zoom).left;
  const stack = origin.classList.contains("page-content") ? origin.closest<HTMLElement>(".page-stack[data-columns]") : null;
  if (!stack) return left;
  const width = Number.parseFloat(stack.style.getPropertyValue("--column-width"));
  const gap = Number.parseFloat(stack.style.getPropertyValue("--column-gap"));
  if (!(width > 0) || !(gap >= 0)) return left;
  const step = (width + gap) * zoom;
  const column = Math.max(0, Math.floor((paragraphLeft - left + 1) / step));
  return left + column * step;
}

function cssZoom(element: Element): number {
  const zoom = (element as Element & { currentCSSZoom?: number }).currentCSSZoom;
  return typeof zoom === "number" && zoom > 0 ? zoom : 1;
}

/** Sets the width of every tab character inside `containers`. */
export function layoutTabsIn(containers: Iterable<Element>): void {
  const byParagraph = new Map<HTMLElement, HTMLElement[]>();
  for (const container of containers) {
    const tabs = container.matches(TAB_SELECTOR) ? [container] : container.querySelectorAll(TAB_SELECTOR);
    for (const tab of tabs) {
      const paragraph = tab.parentElement?.closest<HTMLElement>(TEXTBLOCK_SELECTOR);
      if (!paragraph || !(tab instanceof HTMLElement)) continue;
      const list = byParagraph.get(paragraph) ?? [];
      if (!list.includes(tab)) list.push(tab);
      byParagraph.set(paragraph, list);
    }
  }
  // Hidden paragraphs (behind a version preview) keep their tabs until they are shown.
  for (const paragraph of [...byParagraph.keys()]) if (paragraph.getClientRects().length === 0) byParagraph.delete(paragraph);
  if (byParagraph.size === 0) return;

  // Writes first, then one read of every paragraph's geometry.
  for (const tabs of byParagraph.values()) for (const tab of tabs) tab.style.width = "0px";
  const paragraphs: ParagraphTabs[] = [];
  for (const [paragraph, tabs] of byParagraph) {
    const zoom = cssZoom(paragraph);
    const origin = paragraph.closest<HTMLElement>("td, th, .page-content") ?? paragraph;
    const own = contentEdges(paragraph, zoom);
    tabs.sort((a, b) => (a.compareDocumentPosition(b) & globalThis.Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    paragraphs.push({
      paragraph,
      tabs,
      stops: decodeTabStops(paragraph.dataset.tabStops),
      zoom,
      originX: columnOrigin(origin, own.left, zoom),
      indentX: own.left,
      lineEndX: own.right,
    });
  }

  const range = document.createRange();
  for (let round = 0; ; round++) {
    const active = paragraphs.filter((entry) => round < entry.tabs.length);
    if (active.length === 0) break;
    const widths = active.map((entry) => tabWidth(entry, round, range));
    active.forEach((entry, index) => {
      const tab = entry.tabs[round]!;
      tab.style.width = `${widths[index]}px`;
      tab.dataset.width = String(widths[index]);
    });
  }
}

/** The width in CSS pixels of the paragraph's `index`-th tab, from where it is now. */
function tabWidth(entry: ParagraphTabs, index: number, range: Range): number {
  const tab = entry.tabs[index]!;
  const rect = clientRect(tab);
  const middle = (rect.top + rect.bottom) / 2;
  // The text after the tab on its line, up to the next tab.
  range.setStartAfter(tab);
  const next = entry.tabs[index + 1];
  if (next) range.setEndBefore(next);
  else range.setEnd(entry.paragraph, entry.paragraph.childNodes.length);
  let right = rect.left;
  for (const box of range.getClientRects()) {
    if (box.width > 0 && box.top <= middle && box.bottom >= middle) right = Math.max(right, box.right);
  }
  const points = (clientDistance: number) => clientDistance / entry.zoom / PX_PER_PT;
  const { width } = tabAdvance({
    at: points(rect.left - entry.originX),
    stops: entry.stops,
    indent: points(entry.indentX - entry.originX),
    following: points(right - rect.left),
    lineEnd: points(entry.lineEndX - entry.originX),
  });
  return Math.round(width * PX_PER_PT * 100) / 100;
}

/** Whether a block contains a tab character (cached per node; nodes never change). */
const tabbedBlocks = new WeakMap<Node, boolean>();
function containsTab(block: Node): boolean {
  let known = tabbedBlocks.get(block);
  if (known === undefined) {
    known = false;
    block.descendants((node) => {
      if (node.type.name === "tab") known = true;
      return !known && !node.isLeaf;
    });
    tabbedBlocks.set(block, known);
  }
  return known;
}

/**
 * Keeps the editor's tab characters laid out: after a change, the top-level blocks that changed
 * and contain tabs; everything after a change of the content width or once fonts have loaded.
 */
class TabLayoutView {
  /** Top-level blocks whose tabs are laid out for `width`. */
  private laid = new WeakSet<Node>();
  private width = -1;
  private frame = 0;
  private readonly onFontsLoaded = () => {
    this.laid = new WeakSet();
    this.run();
  };

  constructor(private readonly view: EditorView) {
    document.fonts?.addEventListener("loadingdone", this.onFontsLoaded);
    // The editor's element is put into the page after the editor is created.
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.run();
    });
  }

  update(view: EditorView, previous: EditorState): void {
    const unchanged = view.state.doc === previous.doc;
    // Only documents with tabs pay for the checks (this.width is set once tabs were laid out).
    if (unchanged && (this.width === -1 || (!this.hasStaleTabs() && view.dom.clientWidth === this.width))) return;
    this.run();
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    document.fonts?.removeEventListener("loadingdone", this.onFontsLoaded);
  }

  /** Tab elements ProseMirror drew again (for new decorations) have lost their width. */
  private hasStaleTabs(): boolean {
    return shownTabElement(this.view).querySelector(`${TAB_SELECTOR}:not([data-width])`) !== null;
  }

  run(): void {
    const { view } = this;
    if (view.isDestroyed || !view.dom.isConnected) return;
    // The blocks of the shown tab: the others are hidden, and laid out when they are shown.
    const blocks: { node: Node; pos: number }[] = [];
    const tab = currentTab(view.state);
    tab.node.forEach((node, offset) => {
      if (containsTab(node)) blocks.push({ node, pos: tab.from + offset });
    });
    if (blocks.length === 0) return;
    const width = view.dom.clientWidth;
    if (width !== this.width) {
      this.width = width;
      this.laid = new WeakSet();
    }
    // Hidden: laid out again when shown, as the width then changes back.
    if (width === 0) return;
    const containers = new Set<Element>();
    for (const { node, pos } of blocks) {
      if (this.laid.has(node)) continue;
      const element = view.nodeDOM(pos);
      if (element instanceof Element) containers.add(element);
    }
    for (const element of shownTabElement(view).querySelectorAll(`${TAB_SELECTOR}:not([data-width])`)) containers.add(element);
    if (containers.size === 0) return;
    layoutTabsIn(containers);
    for (const { node } of blocks) this.laid.add(node);
  }
}

export const TabLayout = Extension.create({
  name: "tabLayout",
  addProseMirrorPlugins() {
    return [new Plugin({ view: (view) => new TabLayoutView(view) })];
  },
});

function inList(editor: Editor): boolean {
  return editor.isActive("listItem") || editor.isActive("taskItem");
}

/**
 * Tab and Shift+Tab, below lists and tables (Tab nests list items and moves between cells). Tab
 * types a tab character anywhere in a paragraph, also at its start or on an empty line (a code
 * block gets a literal "\t"); it never indents (⌘+] does) and does nothing across paragraphs.
 * Shift+Tab does nothing. Neither moves the focus out of the document.
 */
export const TabKey = Extension.create({
  name: "tabKey",
  priority: 50,
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        const { editor } = this;
        if (inList(editor)) return true;
        const { $from, $to } = editor.state.selection;
        if (!$from.parent.isTextblock || !$from.sameParent($to)) return true;
        if ($from.parent.type.name === "codeBlock") return editor.commands.command(({ tr }) => Boolean(tr.insertText("\t").scrollIntoView()));
        return editor.commands.insertTab() || true;
      },
      "Shift-Tab": () => true,
    };
  },
});
