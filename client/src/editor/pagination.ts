// Print layout: the document is one continuous content column drawn over a stack of page
// sheets. After every layout change the plugin measures where blocks and lines fall and
// inserts spacer widgets that push content past the bottom margin, the gap between pages
// and the next page's top margin (see pageLayout.ts for the rules).
//
// Spacers are decorations, so they never change the document, the selection or the steps
// that are saved. Measuring happens in requestAnimationFrame, before the browser paints the
// edit, and repeats until the spacers stop changing.
import {
  columnFractions,
  columnKeys,
  columnsOf,
  footnotesOf,
  firstTab,
  pageElementsOf,
  pageGeometry,
  pageSetupKeys,
  pageSetupOf,
  regionFor,
  type DocTab,
  type FootnoteRef,
  type PageGeometry,
  type RegionContent,
} from "@docs/shared";
import { Extension } from "@tiptap/core";
import type { Node, ResolvedPos } from "@tiptap/pm/model";
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
  type Pagination as PageBreaks,
} from "./pageLayout.ts";
import { currentTab, documentTabsKey, shownTabElement } from "./documentTabs.ts";
import { HEADER_OFFSET, regionHTML } from "./regionRender.ts";
import {
  applyColumnStyles,
  columnGeometry,
  columnSpacers,
  drawColumnLines,
  drawnColumnHeights,
  measureColumnsFlat,
  supportsColumnBreaks,
} from "./columnLayout.ts";
import { placeFixedImages } from "./imagePlacement.ts";
import { layOutImageWraps } from "./imageWrap.ts";
import { pinnedRowCount, pinnedRowsKey, tableRowLines } from "./tableLayout.ts";
import { layoutTabsIn } from "./tabLayout.ts";
import { clientRect } from "./rects.ts";
import { flushPendingSelection } from "./pendingSelection.ts";

/** Space between pages, in CSS pixels at 100% zoom. */
export const PAGE_GAP = 10;
/** Measuring passes after one change before the plugin stops, to avoid feedback loops. */
const MAX_PASSES = 6;

/**
 * A spacer as rendered: block spacers are shorter than their shift by the margins they stop
 * collapsing. With columns a spacer is `breaks` forced column breaks, then (to a new page) a
 * spacer `height` tall across all columns and `after` more column breaks. A spacer between table
 * rows repeats the table's pinned rows (`repeat` identifies their content).
 */
type RenderedSpacer = PageSpacer & {
  height: number;
  breaks?: number;
  spanner?: boolean;
  after?: number;
  fill?: number;
  endFill?: number;
  repeat?: string;
  /** With columns, between table rows: the widths of the table's columns in CSS pixels (see tableSizeRow). */
  sizes?: string;
  end?: boolean;
};

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

const footnoteLists = new WeakMap<Node, { from: number; list: FootnoteRef[] }>();

/**
 * The footnotes of the shown tab, numbered from 1 in each tab (cached per tab, as the selectors
 * that need them run on every transaction).
 */
export function documentFootnotes(state: EditorState): FootnoteRef[] {
  return tabFootnotes(state.doc, currentTab(state));
}

/** The footnotes of one tab, with positions in the document. */
export function tabFootnotes(doc: Node, tab: DocTab): FootnoteRef[] {
  const cached = footnoteLists.get(tab.node);
  if (cached && cached.from === tab.from) return cached.list;
  // A tab node's content starts one position after the node; a document's at 0.
  const offset = tab.pos === null ? 0 : tab.from;
  const list = footnotesOf(tab.node).map(({ pos, node }) => ({ pos: pos + offset, node }));
  footnoteLists.set(tab.node, { from: tab.from, list });
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
  // Another tab is shown: its pages are laid out from scratch.
  if ((meta && "reset" in meta) || tr.getMeta(documentTabsKey)) {
    const reset = meta && "reset" in meta ? meta : { enabled: undefined, gap: undefined };
    return {
      enabled: reset.enabled ?? value.enabled,
      gap: reset.gap ?? value.gap,
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
  if ([...pageSetupKeys, ...columnKeys].some((key) => tr.before.attrs[key] !== tr.doc.attrs[key])) {
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
  return decorations.find(undefined, undefined, (spec) => spec.spacer !== undefined).filter((decoration) => {
    const $pos = tr.doc.resolve(decoration.from);
    if (!$pos.parent.isTextblock) return false;
    if (!(decoration.spec.spacer as RenderedSpacer).inline) return true;
    const start = $pos.start();
    const end = $pos.end();
    return changed.some(([from, to]) => from <= end && to >= start);
  });
}

function spacerDecorations(doc: Node, spacers: RenderedSpacer[]): DecorationSet {
  const decorations = spacers.map((spacer) =>
    Decoration.widget(
      spacer.pos,
      (view) =>
        spacer.breaks !== undefined
          ? spacer.sizes !== undefined
            ? tableColumnSpacerElement(view, doc, spacer)
            : columnSpacerElement(spacer)
          : (tableSpacerElement(view, doc, spacer) ?? spacerElement(spacer)),
      {
        // Before the cursor, so a cursor at the start of a moved line shows on the new page. The
        // spacer after the content stays after content inserted at the end.
        side: spacer.end ? 1 : -1,
        ignoreSelection: true,
        key: `page-spacer:${spacer.inline}:${spacer.height}:${spacer.shift}:${spacer.breaks ?? ""}:${spacer.spanner ?? ""}:${spacer.after ?? ""}:${spacer.fill ?? ""}:${spacer.endFill ?? ""}:${spacer.repeat ?? ""}:${spacer.sizes ?? ""}`,
        spacer,
      },
    ),
  );
  // A table broken into columns starts with a row that gives its first part the columns' widths.
  const split = new Map<number, string>();
  for (const spacer of spacers) if (spacer.sizes !== undefined) split.set(doc.resolve(spacer.pos).start(), spacer.sizes);
  for (const [start, sizes] of split) {
    decorations.push(Decoration.widget(start, () => tableSizeRow(sizes), { side: -1, ignoreSelection: true, key: `table-size:${sizes}` }));
  }
  return DecorationSet.create(doc, decorations);
}

function spacerElement(spacer: RenderedSpacer): HTMLElement {
  const element = document.createElement("span");
  element.className = "page-spacer";
  element.style.height = `${spacer.height}px`;
  element.dataset.shift = String(spacer.shift);
  element.setAttribute("aria-hidden", "true");
  return element;
}

/**
 * With columns: forced column breaks, and to a new page a spacer across all columns that ends
 * the page's columns and reaches the next page's top margin (see docs/design/columns.md).
 */
function columnSpacerElement(spacer: RenderedSpacer): HTMLElement {
  const element = document.createElement("span");
  element.className = "column-spacer";
  element.setAttribute("aria-hidden", "true");
  const columnBreak = (fill = 0) => {
    const part = document.createElement("span");
    part.className = "column-break-spacer";
    if (fill > 0) part.style.height = `${fill}px`;
    return part;
  };
  if (spacer.endFill) {
    const filler = document.createElement("span");
    filler.className = "column-filler";
    filler.style.height = `${spacer.endFill}px`;
    element.append(filler);
  }
  const breaks = spacer.breaks ?? 0;
  // The columns these breaks start are empty, but the one a break within a page starts.
  const empty = spacer.spanner ? breaks : breaks - 1;
  for (let index = 0; index < breaks; index++) element.append(columnBreak(index < empty ? spacer.fill : 0));
  if (spacer.spanner) {
    const spanner = document.createElement("span");
    spanner.className = "page-spacer column-spanner";
    spanner.style.height = `${spacer.height}px`;
    spanner.dataset.pos = String(spacer.pos);
    element.append(spanner);
  }
  for (let index = 0; index < (spacer.after ?? 0); index++) element.append(columnBreak());
  return element;
}

/**
 * A spacer between two rows of a table: a row without borders that takes the rest of the page, then
 * copies of the table's pinned rows at the top of the next page. Null when `pos` is not in a table.
 */
function tableSpacerElement(view: EditorView, doc: Node, spacer: RenderedSpacer): HTMLElement | null {
  if (!spacer.inline || spacer.pos > doc.content.size) return null;
  const $pos = doc.resolve(spacer.pos);
  if ($pos.parent.type.spec.tableRole !== "table") return null;
  const group = document.createElement("span");
  group.className = "table-page-spacer";
  group.setAttribute("aria-hidden", "true");
  const gap = document.createElement("tr");
  gap.className = "table-page-gap";
  const cell = gap.appendChild(document.createElement("td"));
  cell.colSpan = 1000;
  cell.style.height = `${Math.max(0, spacer.height)}px`;
  group.append(gap, ...pinnedRowCopies(view, $pos));
  group.lastElementChild!.setAttribute("data-shift", String(spacer.shift));
  return group;
}

/**
 * With columns, a spacer between two rows of a table: the column breaks (or fillers) and the spanner
 * to the next page, then a row that sizes the table's columns and copies of its pinned rows. While a
 * table holds one, its table and row group are `display: contents`, so its rows form a table of their
 * own (an anonymous one) between every two spacers, and the spacers are blocks between them, as
 * between paragraphs (see docs/design/columns.md).
 */
function tableColumnSpacerElement(view: EditorView, doc: Node, spacer: RenderedSpacer): HTMLElement {
  const element = columnSpacerElement(spacer);
  element.classList.add("table-column-spacer");
  if (spacer.pos <= doc.content.size) element.append(tableSizeRow(spacer.sizes ?? ""), ...pinnedRowCopies(view, doc.resolve(spacer.pos)));
  return element;
}

/** A row without height or borders whose cells are the table's columns, `sizes` wide (CSS pixels, separated by spaces). */
function tableSizeRow(sizes: string): HTMLElement {
  const row = document.createElement("tr");
  row.className = "table-size-row";
  row.setAttribute("aria-hidden", "true");
  row.contentEditable = "false";
  for (const width of sizes.split(" ").filter(Boolean)) row.appendChild(document.createElement("td")).style.width = `${width}px`;
  return row;
}

/** Copies of the pinned rows of the table `$pos` is in, which repeat at the top of every page or column it continues to. */
function pinnedRowCopies(view: EditorView, $pos: ResolvedPos): HTMLElement[] {
  const wrapper = view.nodeDOM($pos.before());
  const rows = wrapper instanceof HTMLElement ? tableRowElements(wrapper) : [];
  return rows.slice(0, pinnedRowCount($pos.parent)).map((row) => {
    const copy = row.cloneNode(true) as HTMLTableRowElement;
    copy.classList.add("table-repeat-row");
    for (const element of [copy, ...copy.querySelectorAll("*")]) {
      element.removeAttribute("contenteditable");
      element.classList.remove("selectedCell");
    }
    copy.contentEditable = "false";
    return copy;
  });
}

function currentSpacers(state: EditorState): RenderedSpacer[] {
  return currentSpacersOf(paginationKey.getState(state)!);
}

function currentSpacersOf(value: PaginationState): RenderedSpacer[] {
  return value.decorations
    .find(undefined, undefined, (spec) => spec.spacer !== undefined)
    .map((decoration) => ({ ...(decoration.spec.spacer as RenderedSpacer), pos: decoration.from }));
}

/**
 * Whether two sets of spacers draw the same. Heights may differ by layout rounding: measured with
 * a spacer of 205.73px, the next pass can ask for 205.75px and then for 205.73px again.
 */
function sameRenderedSpacers(a: RenderedSpacer[], b: RenderedSpacer[]): boolean {
  const close = (x = 0, y = 0) => Math.abs(x - y) < 0.1;
  return (
    sameSpacers(a, b) &&
    a.every((spacer, i) => {
      const other = b[i]!;
      return (
        close(spacer.height, other.height) &&
        spacer.breaks === other.breaks &&
        spacer.spanner === other.spanner &&
        spacer.after === other.after &&
        close(spacer.fill, other.fill) &&
        close(spacer.endFill, other.endFill) &&
        spacer.repeat === other.repeat &&
        spacer.sizes === other.sizes
      );
    })
  );
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
      if (this.view.isDestroyed) return;
      // With columns, a page's spacer is sized from its columns as drawn: lay out once more right
      // away, so the corrected spacers are what gets painted.
      if (this.layout() && columnsOf(this.view.state.doc).columns > 1 && !this.view.isDestroyed) this.layout();
    });
  }

  /** Measures and dispatches new spacers; returns whether anything changed. */
  private layout(): boolean {
    const { view } = this;
    const stack = applyPageStyles(view);
    const state = paginationKey.getState(view.state)!;
    if (!stack) return false;
    // Text on both sides of images changes where lines break, so it goes first.
    const wrapped = layOutImageWraps(view, stack, state.enabled && columnsOf(view.state.doc).columns > 1);
    if (!state.enabled) {
      setPageCount(stack, 1);
      return wrapped;
    }

    const geometry = pageGeometry(pageSetupOf(view.state.doc));
    const stackRect = stack.getBoundingClientRect();
    // Hidden (for example behind a version preview); measured again when it is shown.
    if (stackRect.width === 0) return false;
    const scale = stackRect.width / geometry.width;
    stack.style.setProperty("--page-gap", `${state.gap}px`);

    const columns = columnGeometry(view.state.doc, geometry);
    const frame: PageFrame = { ...this.pageFrame(stack, geometry, state.gap, scale), columns: columns.count };
    // The first page's content starts below its header.
    stack.style.setProperty("--content-top", `${frame.firstMarginTop}px`);

    const toY = (clientY: number) => (clientY - stackRect.top) / scale;
    const root = shownTabElement(view);
    const stride = geometry.height + state.gap;
    placeFixedImages(root, toY, stride);
    const footnotes = documentFootnotes(view.state);
    const footnoteHeight = (content: RegionContent) => this.footnoteHeight(stack, geometry, scale, content);

    let pagination: PageBreaks;
    let rendered: RenderedSpacer[];
    if (columns.count > 1) {
      const marginAt = (pos: number, inline = false) => (inline ? 0 : blockMarginTop(view, pos));
      const drawn = drawnColumnHeights(root, toY, contentTop(frame, 0), marginAt);
      pagination = measureColumnsFlat(stack, () => paginate(layoutBoxes(view, toY, footnotes, footnoteHeight), frame));
      rendered = columnSpacers(pagination, frame, drawn, marginAt, currentTab(view.state).to, supportsColumnBreaks()).map((spacer) =>
        tableColumnSpacer(view.state.doc, spacer, columns.width),
      );
    } else {
      const natural = naturalPositions(view, toY);
      pagination = paginate(layoutBoxes(view, (y) => natural(toY(y)), footnotes, footnoteHeight), frame);
      rendered = pagination.spacers.map((spacer) => renderedSpacer(view, spacer));
    }
    const { pageCount, footnotePages } = pagination;
    setPageCount(stack, pageCount);
    drawColumnLines(stack, frame, pageCount, geometry, columns);

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
      updatePageFields(view, stack, stride, scale);
      return wrapped;
    }

    // A redraw writes the editor's selection back to the DOM. Read a caret move the browser has
    // just made (arrow keys, clicks) first, or the redraw would put the caret back.
    flushPendingSelection(view);
    const tr = view.state.tr.setMeta(paginationKey, { spacers: rendered, layout } satisfies PaginationMeta).setMeta("addToHistory", false);
    if (state.scroll && view.hasFocus()) tr.scrollIntoView();
    view.dispatch(tr);
    updatePageFields(view, stack, stride, scale);
    return true;
  }

  /** The page geometry with the space headers and footers take: taller ones push the content in. */
  private pageFrame(stack: HTMLElement, geometry: PageGeometry, gap: number, scale: number): Required<Omit<PageFrame, "columns">> {
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
    layoutTabsIn([element]);
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
  const fields = shownTabElement(view).querySelectorAll<HTMLElement>(".page-field, .footnote-ref");
  if (fields.length === 0) return;
  const start = pageElementsOf(view.state.doc).pageNumberStart;
  const count = stack.dataset.pageCount ?? "1";
  const top = stack.getBoundingClientRect().top;
  let footnote = 0;
  for (const field of fields) {
    let value: string;
    if (field.classList.contains("footnote-ref")) value = String(++footnote);
    else if (field.dataset.field === "count") value = count;
    else value = String(Math.max(0, Math.floor((clientRect(field).top - top) / scale / stride)) + start);
    if (field.textContent !== value) field.textContent = value;
  }
}

/**
 * Converts a measured position into the position it would have without the current spacers,
 * by subtracting the shift of every spacer above it. A position is below a spacer when it is
 * below the spacer's middle: Firefox's text boxes reach a little beyond their line, so the top of
 * the first line after a spacer can be above the spacer's bottom.
 */
function naturalPositions(view: EditorView, toY: (clientY: number) => number): (y: number) => number {
  const spacers = Array.from(shownTabElement(view).querySelectorAll<HTMLElement>("[data-shift]"), (element) => {
    const rect = element.getBoundingClientRect();
    return { middle: toY((rect.top + rect.bottom) / 2), shift: Number(element.dataset.shift) || 0 };
  }).sort((a, b) => a.middle - b.middle);
  return (y) => {
    let total = 0;
    for (const spacer of spacers) {
      if (spacer.middle > y) break;
      total += spacer.shift;
    }
    return y - total;
  };
}

type BoxNode = { node: Node; pos: number; breakPos: number };

/** Textblocks and atomic blocks (images, rules, tables, page breaks) of a tab (the shown one), in document order. */
export function boxNodes(doc: Node, tab: DocTab = firstTab(doc)): BoxNode[] {
  const boxes: BoxNode[] = [];
  const visit = (node: Node, pos: number, breakPos: number) => {
    if (isLayoutBox(node)) {
      boxes.push({ node, pos, breakPos });
      return;
    }
    // The first child moves with its container, so a moved list item keeps its bullet.
    node.forEach((child, offset, index) => visit(child, pos + 1 + offset, index === 0 ? breakPos : pos + 1 + offset));
  };
  const start = tab.pos === null ? 0 : tab.from;
  tab.node.forEach((child, offset) => visit(child, start + offset, start + offset));
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
  for (const { node, pos, breakPos } of boxNodes(view.state.doc, currentTab(view.state))) {
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
    // Images behind or in front of text are placed freely and take no room.
    if (node.type.name === "image" && (node.attrs.wrap === "behind" || node.attrs.wrap === "front")) continue;
    // A suggested object hidden by Viewing mode or a preview (a deleted page break) takes no room and breaks nothing.
    if ((node.attrs.suggestionInsert || node.attrs.suggestionDelete) && element.getClientRects().length === 0) continue;
    const rect = element.getBoundingClientRect();
    const table = node.type.spec.tableRole === "table";
    boxes.push({
      top: toNatural(rect.top),
      bottom: toNatural(rect.bottom),
      breakPos,
      pageBreak: node.type.name === "pageBreak",
      columnBreak: node.type.name === "columnBreak",
      lines: node.isTextblock
        ? () => textblockLines(view, node, pos, element, toNatural)
        : table
          ? () => tableRowLines(node, pos, tableRowElements(element), toNatural)
          : undefined,
      footnotes: notes,
    });
  }
  return boxes;
}

/** The rows of a table as drawn (the editor wraps the table in a div), without the copies of pinned rows. */
function tableRowElements(element: HTMLElement): HTMLElement[] {
  const table = element.matches("table") ? element : element.querySelector(":scope > table");
  return table ? Array.from(table.querySelectorAll<HTMLElement>(":scope > tbody > tr:not(.table-size-row)")) : [];
}

/**
 * A spacer between two rows of a table, with columns: it repeats the pinned rows and sizes the
 * table's columns (`columnWidth` wide in all), as its rows are then drawn as tables of their own.
 */
function tableColumnSpacer(doc: Node, spacer: RenderedSpacer, columnWidth: number): RenderedSpacer {
  if (!spacer.inline || spacer.pos > doc.content.size) return spacer;
  const table = doc.resolve(spacer.pos).parent;
  if (table.type.spec.tableRole !== "table") return spacer;
  const sizes = columnFractions(table)
    .map((fraction) => Math.round(fraction * columnWidth * 100) / 100)
    .join(" ");
  return { ...spacer, repeat: pinnedRowsKey(table), sizes };
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

/** How a spacer of a one-column layout is drawn: between table rows, the pinned rows repeat below it. */
function renderedSpacer(view: EditorView, spacer: PageSpacer): RenderedSpacer {
  if (!spacer.inline) {
    return { ...spacer, height: Math.max(0, Math.round((spacer.shift - collapsedMargin(view, spacer.pos)) * 100) / 100) };
  }
  const $pos = view.state.doc.resolve(spacer.pos);
  if ($pos.parent.type.spec.tableRole !== "table") return { ...spacer, height: spacer.shift };
  return {
    ...spacer,
    height: Math.round((spacer.shift - (spacer.carry ?? 0)) * 100) / 100,
    repeat: pinnedRowsKey($pos.parent),
  };
}

/** The top margin of the block at `pos`, which is kept after a column break or a page's columns. */
function blockMarginTop(view: EditorView, pos: number): number {
  const element = view.nodeDOM(pos);
  return element instanceof HTMLElement ? Number.parseFloat(getComputedStyle(element).marginTop) || 0 : 0;
}

/** Sizes the page stack around the editor from the document's page setup. */
function applyPageStyles(view: EditorView): HTMLElement | null {
  const stack = view.dom.closest<HTMLElement>(".page-stack");
  if (!stack) return null;
  const setup = pageSetupOf(view.state.doc);
  const geometry = pageGeometry(setup);
  setGeometry(stack, geometry);
  stack.style.setProperty("--page-color", setup.pageColor);
  applyColumnStyles(stack, columnGeometry(view.state.doc, geometry), paginationKey.getState(view.state)?.enabled ?? false);
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
