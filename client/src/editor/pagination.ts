// Print layout: the document is one continuous content column drawn over a stack of page
// sheets. After every layout change the plugin measures where blocks and lines fall and
// inserts spacer widgets that push content past the bottom margin, the gap between pages
// and the next page's top margin (see pageLayout.ts for the rules).
//
// Spacers are decorations, so they never change the document, the selection or the steps
// that are saved. Measuring happens in requestAnimationFrame, before the browser paints the
// edit, and repeats until the spacers stop changing.
import {
  footnotesOf,
  pageElementsOf,
  pageGeometry,
  pageSetupKeys,
  pageSetupOf,
  regionFor,
  type FootnoteRef,
  type PageGeometry,
  type RegionContent,
} from "@docs/shared";
import { Extension } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import {
  contentBottom,
  contentTop,
  paginate,
  sameSpacers,
  type LayoutBox,
  type LayoutFootnote,
  type LayoutLine,
  type PageFrame,
  type PageSpacer,
} from "./pageLayout.ts";
import { HEADER_OFFSET, regionHTML } from "./regionRender.ts";

/** Space between pages, in CSS pixels at 100% zoom. */
export const PAGE_GAP = 10;
/** Measuring passes after one change before the plugin stops, to avoid feedback loops. */
const MAX_PASSES = 6;

/** A spacer as rendered: block spacers are shorter than their shift by the margins they stop collapsing. */
type RenderedSpacer = PageSpacer & { height: number };

/**
 * Where the pages' content and footnotes are, for drawing headers, footers and footnotes over
 * the pages. Offsets are from the top of a page, in CSS pixels at 100% zoom.
 */
export type PageLayout = {
  pageCount: number;
  gap: number;
  firstTop: number;
  top: number;
  firstBottom: number;
  bottom: number;
  /** The page (0-based) of footnote n + 1. */
  footnotePages: number[];
};

type PaginationState = {
  enabled: boolean;
  /** Space between pages: PAGE_GAP on screen, none while printing. */
  gap: number;
  layout: PageLayout | null;
  decorations: DecorationSet;
  /** The last user edit asked to scroll the cursor into view, so the spacers that follow it should too. */
  scroll: boolean;
  /** Measuring passes since the last edit or reset. */
  pass: number;
};

type PaginationMeta = { spacers: RenderedSpacer[]; layout: PageLayout } | { reset: true; enabled?: boolean; gap?: number };

export const paginationKey = new PluginKey<PaginationState>("pagination");

/**
 * Lays the pages out again from scratch, for changes the plugin cannot see itself:
 * zoom, fonts or the print layout setting.
 */
export function resetPagination(view: EditorView, enabled?: boolean, gap?: number): void {
  view.dispatch(view.state.tr.setMeta(paginationKey, { reset: true, enabled, gap } satisfies PaginationMeta).setMeta("addToHistory", false));
}

/** The current page layout, or null without print layout or before the first measurement. */
export function pageLayoutOf(state: EditorState): PageLayout | null {
  const value = paginationKey.getState(state);
  return value?.enabled ? value.layout : null;
}

const footnoteLists = new WeakMap<Node, FootnoteRef[]>();

/** The document's footnotes (cached per document, as the selectors that need them run on every transaction). */
export function documentFootnotes(doc: Node): FootnoteRef[] {
  let list = footnoteLists.get(doc);
  if (!list) {
    list = footnotesOf(doc);
    footnoteLists.set(doc, list);
  }
  return list;
}

export const Pagination = Extension.create({
  name: "pagination",
  addProseMirrorPlugins() {
    return [paginationPlugin()];
  },
});

function paginationPlugin(): Plugin<PaginationState> {
  return new Plugin<PaginationState>({
    key: paginationKey,
    state: {
      init: () => ({ enabled: true, gap: PAGE_GAP, layout: null, decorations: DecorationSet.empty, scroll: false, pass: 0 }),
      apply: applyTransaction,
    },
    props: {
      decorations: (state) => {
        const value = paginationKey.getState(state)!;
        return value.enabled ? value.decorations : DecorationSet.empty;
      },
    },
    view: (view) => new PaginationView(view),
  });
}

function applyTransaction(tr: Transaction, value: PaginationState): PaginationState {
  const meta = tr.getMeta(paginationKey) as PaginationMeta | undefined;
  if (meta && "reset" in meta) {
    return {
      enabled: meta.enabled ?? value.enabled,
      gap: meta.gap ?? value.gap,
      layout: value.layout,
      decorations: DecorationSet.empty,
      scroll: false,
      pass: 0,
    };
  }
  if (meta) {
    const layout = value.layout && sameLayout(value.layout, meta.layout) ? value.layout : meta.layout;
    const decorations = sameRenderedSpacers(currentSpacersOf(value), meta.spacers) ? value.decorations : spacerDecorations(tr.doc, meta.spacers);
    return { ...value, layout, decorations, scroll: false, pass: value.pass + 1 };
  }
  if (!tr.docChanged) return value;

  const scroll = value.scroll || tr.scrolledIntoView;
  // New page settings change every line, so start over.
  if (pageSetupKeys.some((key) => tr.before.attrs[key] !== tr.doc.attrs[key])) {
    return { ...value, decorations: DecorationSet.empty, scroll, pass: 0 };
  }
  const decorations = value.decorations.map(tr.mapping, tr.doc);
  return { ...value, decorations: decorations.remove(staleSpacers(tr, decorations)), scroll, pass: 0 };
}

/**
 * Spacers inside a changed textblock no longer sit where its lines wrap, and would force
 * a line break of their own. They are removed so the next measurement sees the natural lines.
 */
function staleSpacers(tr: Transaction, decorations: DecorationSet): Decoration[] {
  const changed: [number, number][] = [];
  tr.mapping.maps.forEach((map, index) => {
    const rest = tr.mapping.slice(index + 1);
    map.forEach((_oldStart, _oldEnd, start, end) => changed.push([rest.map(start, -1), rest.map(end, 1)]));
  });
  return decorations.find().filter((decoration) => {
    const $pos = tr.doc.resolve(decoration.from);
    if (!$pos.parent.isTextblock) return false;
    if (!(decoration.spec.spacer as RenderedSpacer).inline) return true;
    const start = $pos.start();
    const end = $pos.end();
    return changed.some(([from, to]) => from <= end && to >= start);
  });
}

function spacerDecorations(doc: Node, spacers: RenderedSpacer[]): DecorationSet {
  return DecorationSet.create(
    doc,
    spacers.map((spacer) =>
      Decoration.widget(spacer.pos, () => spacerElement(spacer), {
        // Before the cursor, so a cursor at the start of a moved line shows on the new page.
        side: -1,
        ignoreSelection: true,
        key: `page-spacer:${spacer.inline}:${spacer.height}:${spacer.shift}`,
        spacer,
      }),
    ),
  );
}

function spacerElement(spacer: RenderedSpacer): HTMLElement {
  const element = document.createElement("span");
  element.className = "page-spacer";
  element.style.height = `${spacer.height}px`;
  element.dataset.shift = String(spacer.shift);
  element.setAttribute("aria-hidden", "true");
  return element;
}

function currentSpacers(state: EditorState): RenderedSpacer[] {
  return currentSpacersOf(paginationKey.getState(state)!);
}

function currentSpacersOf(value: PaginationState): RenderedSpacer[] {
  return value.decorations.find().map((decoration) => ({ ...(decoration.spec.spacer as RenderedSpacer), pos: decoration.from }));
}

function sameRenderedSpacers(a: RenderedSpacer[], b: RenderedSpacer[]): boolean {
  return sameSpacers(a, b) && a.every((spacer, i) => spacer.height === b[i]!.height);
}

function sameLayout(a: PageLayout, b: PageLayout): boolean {
  return (
    a.pageCount === b.pageCount &&
    a.gap === b.gap &&
    a.firstTop === b.firstTop &&
    a.top === b.top &&
    a.firstBottom === b.firstBottom &&
    a.bottom === b.bottom &&
    a.footnotePages.length === b.footnotePages.length &&
    a.footnotePages.every((page, i) => page === b.footnotePages[i])
  );
}

const paginationViews = new WeakMap<EditorView, PaginationView>();

/**
 * Lays the pages out now rather than in the next frame, for commands that need the new layout
 * right away (the page of a new footnote, the page numbers of a new table of contents).
 */
export function layOutNow(view: EditorView): void {
  paginationViews.get(view)?.layOutNow();
}

class PaginationView {
  private frame = 0;
  /** Measured heights of header, footer and footnote content, by content object. */
  private heights = new WeakMap<RegionContent, number>();
  private footnoteHeights = new WeakMap<RegionContent, number>();
  private measuredWidth = 0;
  private measureBox: HTMLElement | null = null;
  private readonly onFontsLoaded = () => this.reset();
  private readonly onLoad = (event: Event) => {
    if (event.target instanceof HTMLImageElement) this.schedule();
  };
  private readonly onBeforePrint = () => this.layOutForPrint(true);
  private readonly onAfterPrint = () => this.layOutForPrint(false);

  constructor(private readonly view: EditorView) {
    document.fonts?.addEventListener("loadingdone", this.onFontsLoaded);
    view.dom.addEventListener("load", this.onLoad, true);
    window.addEventListener("beforeprint", this.onBeforePrint);
    window.addEventListener("afterprint", this.onAfterPrint);
    paginationViews.set(view, this);
    this.schedule();
  }

  layOutNow(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    for (let pass = 0; pass < MAX_PASSES && !this.view.isDestroyed && this.layout(); pass++);
  }

  update(view: EditorView, previous: EditorState): void {
    const before = paginationKey.getState(previous);
    const after = paginationKey.getState(view.state);
    if (view.state.doc === previous.doc && before === after) return;
    applyPageStyles(view);
    // New spacers are measured again, a limited number of times.
    if ((after?.pass ?? 0) < MAX_PASSES) this.schedule();
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    document.fonts?.removeEventListener("loadingdone", this.onFontsLoaded);
    this.view.dom.removeEventListener("load", this.onLoad, true);
    window.removeEventListener("beforeprint", this.onBeforePrint);
    window.removeEventListener("afterprint", this.onAfterPrint);
    this.measureBox?.remove();
  }

  private reset(): void {
    this.heights = new WeakMap();
    this.footnoteHeights = new WeakMap();
    if (!this.view.isDestroyed) resetPagination(this.view);
  }

  /**
   * Printing prints the pages as laid out on screen: without gaps between them and at 100%
   * zoom, laid out synchronously before the browser paginates the printout.
   */
  private layOutForPrint(printing: boolean): void {
    const stack = this.view.dom.closest<HTMLElement>(".page-stack");
    const state = paginationKey.getState(this.view.state);
    if (!stack || !state?.enabled || this.view.isDestroyed) return;
    stack.classList.toggle("is-printing", printing);
    resetPagination(this.view, undefined, printing ? 0 : PAGE_GAP);
    if (!printing) return this.schedule();
    this.layOutNow();
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (!this.view.isDestroyed) this.layout();
    });
  }

  /** Measures and dispatches new spacers; returns whether anything changed. */
  private layout(): boolean {
    const { view } = this;
    const stack = applyPageStyles(view);
    const state = paginationKey.getState(view.state)!;
    if (!stack) return false;
    if (!state.enabled) {
      setPageCount(stack, 1);
      return false;
    }

    const geometry = pageGeometry(pageSetupOf(view.state.doc));
    const stackRect = stack.getBoundingClientRect();
    // Hidden (for example behind a version preview); measured again when it is shown.
    if (stackRect.width === 0) return false;
    const scale = stackRect.width / geometry.width;
    stack.style.setProperty("--page-gap", `${state.gap}px`);

    const frame = this.pageFrame(stack, geometry, state.gap, scale);
    // The first page's content starts below its header.
    stack.style.setProperty("--content-top", `${frame.firstMarginTop}px`);

    const toY = (clientY: number) => (clientY - stackRect.top) / scale;
    const natural = naturalPositions(view, toY);
    const footnotes = documentFootnotes(view.state.doc);
    const boxes = layoutBoxes(view, (y) => natural(toY(y)), footnotes, (content) => this.footnoteHeight(stack, geometry, scale, content));
    const { spacers, pageCount, footnotePages } = paginate(boxes, frame);
    setPageCount(stack, pageCount);

    const rendered = spacers.map((spacer) => ({
      ...spacer,
      height: spacer.inline ? spacer.shift : Math.max(0, Math.round((spacer.shift - collapsedMargin(view, spacer.pos)) * 100) / 100),
    }));
    const layout: PageLayout = {
      pageCount,
      gap: state.gap,
      firstTop: contentTop(frame, 0),
      top: contentTop(frame, 1) - (geometry.height + state.gap),
      firstBottom: contentBottom(frame, 0),
      bottom: contentBottom(frame, 1) - (geometry.height + state.gap),
      footnotePages: footnotes.map((_note, index) => footnotePages[index] ?? footnotePages[index - 1] ?? 0),
    };
    const current = currentSpacers(view.state);
    if (sameRenderedSpacers(rendered, current) && state.layout && sameLayout(state.layout, layout)) {
      updatePageFields(view, stack, geometry.height + state.gap, scale);
      return false;
    }

    // A redraw writes the editor's selection back to the DOM. Read a caret move the browser has
    // just made (arrow keys, clicks) first, or the redraw would put the caret back.
    flushPendingSelection(view);
    const tr = view.state.tr.setMeta(paginationKey, { spacers: rendered, layout } satisfies PaginationMeta).setMeta("addToHistory", false);
    if (state.scroll && view.hasFocus()) tr.scrollIntoView();
    view.dispatch(tr);
    updatePageFields(view, stack, geometry.height + state.gap, scale);
    return true;
  }

  /** The page geometry with the space headers and footers take: taller ones push the content in. */
  private pageFrame(stack: HTMLElement, geometry: PageGeometry, gap: number, scale: number): Required<PageFrame> {
    const settings = pageElementsOf(this.view.state.doc);
    const height = (kind: "header" | "footer", page: number) => {
      const content = regionFor(settings, kind, page);
      return content ? this.regionHeight(stack, geometry, scale, content) : 0;
    };
    const top = (page: number) => {
      const header = height("header", page);
      return header > 0 ? Math.max(geometry.marginTop, HEADER_OFFSET + header) : geometry.marginTop;
    };
    const bottom = (page: number) => {
      const footer = height("footer", page);
      return footer > 0 ? Math.max(geometry.marginBottom, HEADER_OFFSET + footer) : geometry.marginBottom;
    };
    return {
      pageHeight: geometry.height,
      gap,
      marginTop: top(1),
      marginBottom: bottom(1),
      firstMarginTop: top(0),
      firstMarginBottom: bottom(0),
    };
  }

  private regionHeight(stack: HTMLElement, geometry: PageGeometry, scale: number, content: RegionContent): number {
    return this.measure(stack, geometry, scale, content, "region", (element) => {
      element.className = "page-content page-region";
      element.innerHTML = regionHTML(this.view.state.schema, content);
    });
  }

  private footnoteHeight(stack: HTMLElement, geometry: PageGeometry, scale: number, content: RegionContent): number {
    return this.measure(stack, geometry, scale, content, "footnote", (element) => {
      element.className = "footnote-entry";
      element.innerHTML = `<sup class="footnote-number">1</sup><div class="page-content page-region footnote-text">${regionHTML(this.view.state.schema, content)}</div>`;
    });
  }

  /** The height of content drawn at the page's content width, in a hidden box (cached). */
  private measure(
    stack: HTMLElement,
    geometry: PageGeometry,
    scale: number,
    content: RegionContent,
    kind: "region" | "footnote",
    fill: (element: HTMLElement) => void,
  ): number {
    const width = geometry.width - geometry.marginLeft - geometry.marginRight;
    if (width !== this.measuredWidth) {
      this.heights = new WeakMap();
      this.footnoteHeights = new WeakMap();
      this.measuredWidth = width;
    }
    const cache = kind === "region" ? this.heights : this.footnoteHeights;
    const known = cache.get(content);
    if (known !== undefined) return known;
    if (!this.measureBox || this.measureBox.parentElement !== stack) {
      this.measureBox = document.createElement("div");
      this.measureBox.className = "page-measure";
      this.measureBox.setAttribute("aria-hidden", "true");
      stack.append(this.measureBox);
    }
    this.measureBox.style.width = `${width}px`;
    const element = document.createElement("div");
    fill(element);
    this.measureBox.replaceChildren(element);
    const height = Math.round((element.getBoundingClientRect().height / scale) * 100) / 100;
    this.measureBox.replaceChildren();
    cache.set(content, height);
    return height;
  }
}

/**
 * Writes the numbers of page number and page count fields and of footnote references in the
 * body. They are leaf nodes, whose DOM ProseMirror leaves alone; until this runs (or after a
 * redraw) CSS counters show them.
 */
function updatePageFields(view: EditorView, stack: HTMLElement, stride: number, scale: number): void {
  const fields = view.dom.querySelectorAll<HTMLElement>(".page-field, .footnote-ref");
  if (fields.length === 0) return;
  const start = pageElementsOf(view.state.doc).pageNumberStart;
  const count = stack.dataset.pageCount ?? "1";
  const top = stack.getBoundingClientRect().top;
  let footnote = 0;
  for (const field of fields) {
    let value: string;
    if (field.classList.contains("footnote-ref")) value = String(++footnote);
    else if (field.dataset.field === "count") value = count;
    else value = String(Math.max(0, Math.floor((field.getBoundingClientRect().top - top) / scale / stride)) + start);
    if (field.textContent !== value) field.textContent = value;
  }
}

/**
 * ProseMirror reads browser selection changes asynchronously; its DOM observer's flush applies
 * any pending one now. The observer is not part of the public API, so this is a no-op if it changes.
 */
function flushPendingSelection(view: EditorView): void {
  const observer = (view as unknown as { domObserver?: { flush?: () => void } }).domObserver;
  observer?.flush?.();
}

/**
 * Converts a measured position into the position it would have without the current spacers,
 * by subtracting the shift of every spacer above it.
 */
function naturalPositions(view: EditorView, toY: (clientY: number) => number): (y: number) => number {
  const spacers = Array.from(view.dom.querySelectorAll<HTMLElement>(".page-spacer"), (element) => ({
    bottom: toY(element.getBoundingClientRect().bottom),
    shift: Number(element.dataset.shift) || 0,
  })).sort((a, b) => a.bottom - b.bottom);
  return (y) => {
    let total = 0;
    for (const spacer of spacers) {
      if (spacer.bottom > y + 0.5) break;
      total += spacer.shift;
    }
    return y - total;
  };
}

type BoxNode = { node: Node; pos: number; breakPos: number };

/** Textblocks and atomic blocks (images, rules, tables, page breaks) in document order. */
export function boxNodes(doc: Node): BoxNode[] {
  const boxes: BoxNode[] = [];
  const visit = (node: Node, pos: number, breakPos: number) => {
    if (isLayoutBox(node)) {
      boxes.push({ node, pos, breakPos });
      return;
    }
    // The first child moves with its container, so a moved list item keeps its bullet.
    node.forEach((child, offset, index) => visit(child, pos + 1 + offset, index === 0 ? breakPos : pos + 1 + offset));
  };
  doc.forEach((child, offset) => visit(child, offset, offset));
  return boxes;
}

/**
 * Blocks laid out as one unit. A table of contents is atomic for editing but breaks between
 * its entries like a list.
 */
function isLayoutBox(node: Node): boolean {
  if (node.type.name === "tableOfContents") return false;
  return node.isTextblock || node.isAtom || node.isLeaf || node.type.spec.tableRole === "table";
}

/** The parts of ProseMirror's view tree that `blockElements` reads; not public API. */
type ViewDesc = { node: Node | null; size: number; border: number; nodeDOM: globalThis.Node; children: ViewDesc[] };

/**
 * The DOM node of every block `boxNodes` returns, by position. `view.nodeDOM` searches the
 * document's top-level blocks from the start for every call, which is quadratic for a long
 * document; this walks the view tree once. Falls back to `nodeDOM` if the tree is not there.
 */
function blockElements(view: EditorView): (pos: number) => globalThis.Node | null {
  const docView = (view as unknown as { docView?: ViewDesc }).docView;
  if (!Array.isArray(docView?.children)) return (pos) => view.nodeDOM(pos);
  const elements = new Map<number, globalThis.Node>();
  const visit = (parent: ViewDesc, start: number) => {
    let pos = start;
    for (const child of parent.children) {
      const { node } = child;
      if (node && child.size > 0) {
        elements.set(pos, child.nodeDOM);
        // The same containers boxNodes descends into.
        if (!isLayoutBox(node)) visit(child, pos + child.border);
      }
      pos += child.size;
    }
  };
  visit(docView, 0);
  return (pos) => elements.get(pos) ?? view.nodeDOM(pos);
}

function layoutBoxes(
  view: EditorView,
  toNatural: (clientY: number) => number,
  footnotes: readonly FootnoteRef[],
  footnoteHeight: (content: RegionContent) => number,
): LayoutBox[] {
  const boxes: LayoutBox[] = [];
  const elementAt = blockElements(view);
  let next = 0;
  for (const { node, pos, breakPos } of boxNodes(view.state.doc)) {
    const element = elementAt(pos);
    // Footnotes referenced in this block (both lists are in document order).
    let notes: LayoutFootnote[] | undefined;
    while (next < footnotes.length && footnotes[next]!.pos < pos + node.nodeSize) {
      const { pos: notePos, node: note } = footnotes[next]!;
      if (notePos >= pos && element instanceof HTMLElement) {
        const coords = view.coordsAtPos(notePos, 1);
        (notes ??= []).push({
          index: next,
          top: toNatural(coords.top),
          bottom: toNatural(coords.bottom),
          height: footnoteHeight(note.attrs.content as RegionContent),
        });
      }
      next += 1;
    }
    if (!(element instanceof HTMLElement)) continue;
    const rect = element.getBoundingClientRect();
    boxes.push({
      top: toNatural(rect.top),
      bottom: toNatural(rect.bottom),
      breakPos,
      pageBreak: node.type.name === "pageBreak",
      lines: node.isTextblock ? () => textblockLines(view, node, pos, element, toNatural) : undefined,
      footnotes: notes,
    });
  }
  return boxes;
}

/** The lines of a textblock, from the boxes of its text. */
function textblockLines(
  view: EditorView,
  node: Node,
  pos: number,
  element: HTMLElement,
  toNatural: (clientY: number) => number,
): LayoutLine[] {
  const rects: DOMRect[] = [];
  const range = document.createRange();
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    if (text.parentElement?.closest(".page-spacer")) continue;
    range.selectNodeContents(text);
    for (const rect of range.getClientRects()) if (rect.height > 0) rects.push(rect);
  }
  rects.sort((a, b) => a.top - b.top);

  const lines: { top: number; bottom: number }[] = [];
  for (const rect of rects) {
    const middle = (rect.top + rect.bottom) / 2;
    const line = lines.at(-1);
    if (line && middle < line.bottom) {
      line.top = Math.min(line.top, rect.top);
      line.bottom = Math.max(line.bottom, rect.bottom);
    } else {
      lines.push({ top: rect.top, bottom: rect.bottom });
    }
  }

  const contentStart = pos + 1;
  const contentEnd = pos + node.nodeSize - 1;
  return lines.map((line) => ({
    top: toNatural(line.top),
    bottom: toNatural(line.bottom),
    start: () => lineStart(view, contentStart, contentEnd, line.top),
  }));
}

/** The first position whose character is on the line starting at `lineTop` (client coordinates). */
function lineStart(view: EditorView, from: number, to: number, lineTop: number): number {
  let low = from;
  let high = to;
  while (low < high) {
    const middle = (low + high) >> 1;
    const coords = view.coordsAtPos(middle, 1);
    if ((coords.top + coords.bottom) / 2 >= lineTop) high = middle;
    else low = middle + 1;
  }
  return low;
}

/** Vertical margins of the blocks around `pos` that collapse now but stop collapsing with a spacer between them. */
function collapsedMargin(view: EditorView, pos: number): number {
  const $pos = view.state.doc.resolve(pos);
  const before = $pos.nodeBefore;
  if (!before || !$pos.nodeAfter) return 0;
  const next = view.nodeDOM(pos);
  const previous = view.nodeDOM(pos - before.nodeSize);
  if (!(next instanceof HTMLElement && previous instanceof HTMLElement)) return 0;
  const top = Number.parseFloat(getComputedStyle(next).marginTop) || 0;
  const bottom = Number.parseFloat(getComputedStyle(previous).marginBottom) || 0;
  return top > 0 && bottom > 0 ? Math.min(top, bottom) : 0;
}

/** Sizes the page stack around the editor from the document's page setup. */
function applyPageStyles(view: EditorView): HTMLElement | null {
  const stack = view.dom.closest<HTMLElement>(".page-stack");
  if (stack) setGeometry(stack, pageGeometry(pageSetupOf(view.state.doc)));
  return stack;
}

export function setGeometry(element: HTMLElement, geometry: PageGeometry): void {
  element.style.setProperty("--page-width", `${geometry.width}px`);
  element.style.setProperty("--page-height", `${geometry.height}px`);
  element.style.setProperty("--margin-top", `${geometry.marginTop}px`);
  element.style.setProperty("--margin-bottom", `${geometry.marginBottom}px`);
  element.style.setProperty("--margin-left", `${geometry.marginLeft}px`);
  element.style.setProperty("--margin-right", `${geometry.marginRight}px`);
}

/** Draws one sheet per page behind the content. */
function setPageCount(stack: HTMLElement, count: number): void {
  stack.style.setProperty("--page-count", String(count));
  stack.dataset.pageCount = String(count);
  const sheets = stack.querySelector(".page-sheets");
  if (!sheets) return;
  while (sheets.childElementCount < count) {
    const sheet = document.createElement("div");
    sheet.className = "page";
    sheet.style.setProperty("--page-index", String(sheets.childElementCount));
    sheets.append(sheet);
  }
  while (sheets.childElementCount > count) sheets.lastElementChild!.remove();
}

/** The page the cursor is on (1-based) and the number of pages, from the current layout. */
export function cursorPage(view: EditorView): { page: number; count: number } {
  const stack = view.dom.closest<HTMLElement>(".page-stack");
  const count = Number(stack?.dataset.pageCount) || 1;
  return { page: Math.min(pageIndexAt(view, view.state.selection.head) + 1, count), count };
}

/** The page (0-based) position `pos` is on, from the current layout. */
export function pageIndexAt(view: EditorView, pos: number): number {
  const stack = view.dom.closest<HTMLElement>(".page-stack");
  const count = Number(stack?.dataset.pageCount) || 1;
  if (!stack || count === 1) return 0;
  const geometry = pageGeometry(pageSetupOf(view.state.doc));
  const stackRect = stack.getBoundingClientRect();
  if (stackRect.width === 0) return 0;
  const scale = stackRect.width / geometry.width;
  const y = (view.coordsAtPos(pos, 1).top - stackRect.top) / scale;
  const gap = paginationKey.getState(view.state)?.gap ?? PAGE_GAP;
  return Math.min(Math.max(Math.floor(y / (geometry.height + gap)), 0), count - 1);
}
