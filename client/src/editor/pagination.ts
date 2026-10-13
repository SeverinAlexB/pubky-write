// Print layout: the document is one continuous content column drawn over a stack of page
// sheets. After every layout change the plugin measures where blocks and lines fall and
// inserts spacer widgets that push content past the bottom margin, the gap between pages
// and the next page's top margin (see pageLayout.ts for the rules).
//
// Spacers are decorations, so they never change the document, the selection or the steps
// that are saved. Measuring happens in requestAnimationFrame, before the browser paints the
// edit, and repeats until the spacers stop changing.
import { pageGeometry, pageSetupKeys, pageSetupOf, type PageGeometry } from "@docs/shared";
import { Extension } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { paginate, sameSpacers, type LayoutBox, type LayoutLine, type PageFrame, type PageSpacer } from "./pageLayout.ts";

/** Space between pages, in CSS pixels at 100% zoom. */
export const PAGE_GAP = 10;
/** Measuring passes after one change before the plugin stops, to avoid feedback loops. */
const MAX_PASSES = 6;

/** A spacer as rendered: block spacers are shorter than their shift by the margins they stop collapsing. */
type RenderedSpacer = PageSpacer & { height: number };

type PaginationState = {
  enabled: boolean;
  decorations: DecorationSet;
  /** The last user edit asked to scroll the cursor into view, so the spacers that follow it should too. */
  scroll: boolean;
  /** Measuring passes since the last edit or reset. */
  pass: number;
};

type PaginationMeta = { spacers: RenderedSpacer[] } | { reset: true; enabled?: boolean };

export const paginationKey = new PluginKey<PaginationState>("pagination");

/**
 * Lays the pages out again from scratch, for changes the plugin cannot see itself:
 * zoom, fonts or the print layout setting.
 */
export function resetPagination(view: EditorView, enabled?: boolean): void {
  view.dispatch(view.state.tr.setMeta(paginationKey, { reset: true, enabled } satisfies PaginationMeta).setMeta("addToHistory", false));
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
      init: () => ({ enabled: true, decorations: DecorationSet.empty, scroll: false, pass: 0 }),
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
    return { enabled: meta.enabled ?? value.enabled, decorations: DecorationSet.empty, scroll: false, pass: 0 };
  }
  if (meta) return { ...value, decorations: spacerDecorations(tr.doc, meta.spacers), scroll: false, pass: value.pass + 1 };
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
  return paginationKey
    .getState(state)!
    .decorations.find()
    .map((decoration) => ({ ...(decoration.spec.spacer as RenderedSpacer), pos: decoration.from }));
}

class PaginationView {
  private frame = 0;
  private readonly onFontsLoaded = () => this.reset();
  private readonly onLoad = (event: Event) => {
    if (event.target instanceof HTMLImageElement) this.schedule();
  };

  constructor(private readonly view: EditorView) {
    document.fonts?.addEventListener("loadingdone", this.onFontsLoaded);
    view.dom.addEventListener("load", this.onLoad, true);
    this.schedule();
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
  }

  private reset(): void {
    if (!this.view.isDestroyed) resetPagination(this.view);
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (!this.view.isDestroyed) this.layout();
    });
  }

  private layout(): void {
    const { view } = this;
    const stack = applyPageStyles(view);
    const state = paginationKey.getState(view.state)!;
    if (!stack) return;
    if (!state.enabled) return setPageCount(stack, 1);

    const geometry = pageGeometry(pageSetupOf(view.state.doc));
    const stackRect = stack.getBoundingClientRect();
    // Hidden (for example behind a version preview); measured again when it is shown.
    if (stackRect.width === 0) return;
    const scale = stackRect.width / geometry.width;
    const toY = (clientY: number) => (clientY - stackRect.top) / scale;
    const natural = naturalPositions(view, toY);

    const frame: PageFrame = {
      pageHeight: geometry.height,
      gap: PAGE_GAP,
      marginTop: geometry.marginTop,
      marginBottom: geometry.marginBottom,
    };
    const { spacers, pageCount } = paginate(layoutBoxes(view, (y) => natural(toY(y))), frame);
    setPageCount(stack, pageCount);

    const rendered = spacers.map((spacer) => ({
      ...spacer,
      height: spacer.inline ? spacer.shift : Math.max(0, Math.round((spacer.shift - collapsedMargin(view, spacer.pos)) * 100) / 100),
    }));
    const current = currentSpacers(view.state);
    if (sameSpacers(rendered, current) && rendered.every((spacer, i) => spacer.height === current[i]!.height)) return;

    const tr = view.state.tr.setMeta(paginationKey, { spacers: rendered } satisfies PaginationMeta).setMeta("addToHistory", false);
    if (state.scroll && view.hasFocus()) tr.scrollIntoView();
    view.dispatch(tr);
  }
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
    if (node.isTextblock || node.isAtom || node.isLeaf || node.type.spec.tableRole === "table") {
      boxes.push({ node, pos, breakPos });
      return;
    }
    // The first child moves with its container, so a moved list item keeps its bullet.
    node.forEach((child, offset, index) => visit(child, pos + 1 + offset, index === 0 ? breakPos : pos + 1 + offset));
  };
  doc.forEach((child, offset) => visit(child, offset, offset));
  return boxes;
}

function layoutBoxes(view: EditorView, toNatural: (clientY: number) => number): LayoutBox[] {
  const boxes: LayoutBox[] = [];
  for (const { node, pos, breakPos } of boxNodes(view.state.doc)) {
    const element = view.nodeDOM(pos);
    if (!(element instanceof HTMLElement)) continue;
    const rect = element.getBoundingClientRect();
    boxes.push({
      top: toNatural(rect.top),
      bottom: toNatural(rect.bottom),
      breakPos,
      pageBreak: node.type.name === "pageBreak",
      lines: node.isTextblock ? () => textblockLines(view, node, pos, element, toNatural) : undefined,
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
  if (!stack || count === 1) return { page: 1, count };
  const geometry = pageGeometry(pageSetupOf(view.state.doc));
  const stackRect = stack.getBoundingClientRect();
  if (stackRect.width === 0) return { page: 1, count };
  const scale = stackRect.width / geometry.width;
  const y = (view.coordsAtPos(view.state.selection.head).top - stackRect.top) / scale;
  const page = Math.floor(y / (geometry.height + PAGE_GAP)) + 1;
  return { page: Math.min(Math.max(page, 1), count), count };
}
