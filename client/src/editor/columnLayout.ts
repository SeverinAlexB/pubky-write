// Columns in print layout (Format > Columns, see docs/design/columns.md). The content is a CSS
// multi-column box; the pagination decides where every column ends and draws that with spacer
// widgets: forced column breaks within a page, and between pages a spacer across all columns
// (`column-span: all`) that ends the page's columns and reaches the next page's top margin.
//
// The browser balances the columns of every page but the last, so each page gets exactly one
// forced break per column boundary, even for empty columns. That leaves the browser no choice:
// every column holds what the pagination put there.
import { columnsOf, PX_PER_PT, type PageGeometry } from "@docs/shared";
import type { Node } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { contentBottom, contentTop, type PageFrame, type Pagination } from "./pageLayout.ts";

/** The columns of the page in CSS pixels. */
export type ColumnGeometry = { count: number; width: number; gap: number; line: boolean };

export function columnGeometry(doc: Node, geometry: PageGeometry): ColumnGeometry {
  const { columns, columnSpacing, columnLine } = columnsOf(doc);
  const content = geometry.width - geometry.marginLeft - geometry.marginRight;
  // The spacing never leaves a column narrower than 1 cm.
  const gap = Math.max(0, Math.min(columnSpacing * PX_PER_PT, (content - columns * 38) / Math.max(1, columns - 1)));
  const width = columns > 1 ? (content - gap * (columns - 1)) / columns : content;
  return { count: columns, width: round(width), gap: round(gap), line: columnLine };
}

/** Turns the page content into columns (or back), with print layout only. */
export function applyColumnStyles(stack: HTMLElement, columns: ColumnGeometry, enabled: boolean): void {
  if (!enabled || columns.count === 1) {
    if (stack.dataset.columns !== undefined) delete stack.dataset.columns;
    return;
  }
  stack.dataset.columns = String(columns.count);
  stack.style.setProperty("--columns", String(columns.count));
  stack.style.setProperty("--column-gap", `${columns.gap}px`);
  stack.style.setProperty("--column-width", `${columns.width}px`);
  // While measuring, the content is one column as wide as a column (see beginColumnMeasure).
  stack.style.setProperty("--column-measure-extra", `${round((columns.width + columns.gap) * (columns.count - 1))}px`);
}

/**
 * Lays the content out as one column of the columns' width, without spacers, so the positions the
 * pagination measures are the natural ones. The browser lays out again when the class is removed;
 * nothing is painted in between.
 */
export function measureColumnsFlat<T>(stack: HTMLElement, measure: () => T): T {
  const scroller = stack.closest<HTMLElement>(".editor-scroll");
  const scrollTop = scroller?.scrollTop;
  stack.classList.add("is-measuring-columns");
  try {
    return measure();
  } finally {
    stack.classList.remove("is-measuring-columns");
    // Scroll anchoring could have moved the view while the content was taller.
    if (scroller && scrollTop !== undefined && scroller.scrollTop !== scrollTop) scroller.scrollTop = scrollTop;
  }
}

/**
 * How tall the columns of each page are as drawn now, from the first block's top to the spacer
 * that ends the page, by that spacer's position. Read before measuring, to size the spacers that
 * follow. `marginAt` is the top margin of the block after a spacer.
 */
export function drawnColumnHeights(
  root: HTMLElement,
  toY: (clientY: number) => number,
  firstTop: number,
  marginAt: (pos: number) => number,
): Map<number, number> {
  const heights = new Map<number, number>();
  let top = firstTop;
  for (const spanner of root.querySelectorAll<HTMLElement>(".column-spanner")) {
    const rect = spanner.getBoundingClientRect();
    const pos = Number(spanner.dataset.pos);
    heights.set(pos, toY(rect.top) - top);
    top = toY(rect.bottom) + marginAt(pos);
  }
  return heights;
}

/** A rendered spacer for columns: see RenderedSpacer in pagination.ts. */
export type ColumnSpacer = Pagination["spacers"][number] & { height: number; breaks: number; spanner: boolean; after: number };

/**
 * The column breaks and page spacers for a pagination with columns. A spacer to a new page is as
 * tall as the rest of the page below the tallest column (as drawn, or else as measured) plus the
 * next page's top margin.
 */
export function columnSpacers(
  pagination: Pagination,
  frame: PageFrame,
  drawn: Map<number, number>,
  marginAt: (pos: number, inline: boolean) => number,
): ColumnSpacer[] {
  const columns = frame.columns ?? 1;
  const heights = pagination.slotHeights ?? [];
  const estimate = (page: number) => Math.max(0, ...heights.slice(page * columns, (page + 1) * columns).map((height) => height ?? 0));
  return pagination.spacers.map((spacer) => {
    const from = spacer.from ?? 0;
    const to = spacer.to ?? from + 1;
    const fromPage = Math.floor(from / columns);
    const toPage = Math.floor(to / columns);
    if (fromPage === toPage) return { ...spacer, height: 0, breaks: to - from, spanner: false, after: 0 };
    const columnsHeight = drawn.get(spacer.pos) ?? estimate(fromPage);
    const height = contentTop(frame, toPage) - contentTop(frame, fromPage) - columnsHeight - marginAt(spacer.pos, spacer.inline);
    return { ...spacer, height: Math.max(0, round(height)), breaks: columns - 1 - (from % columns), spanner: true, after: to % columns };
  });
}

/**
 * The 1px black line between columns: from the top to the bottom of each page's content. Drawn in
 * a layer of its own over the page sheets (which are not printed), so it prints too.
 */
export function drawColumnLines(stack: HTMLElement, frame: PageFrame, pageCount: number, geometry: PageGeometry, columns: ColumnGeometry): void {
  const count = columns.line && columns.count > 1 ? pageCount * (columns.count - 1) : 0;
  let layer = stack.querySelector<HTMLElement>(":scope > .column-lines");
  if (count === 0) return void layer?.replaceChildren();
  if (!layer) {
    layer = document.createElement("div");
    layer.className = "column-lines";
    layer.setAttribute("aria-hidden", "true");
    stack.append(layer);
  }
  while (layer.childElementCount > count) layer.lastElementChild!.remove();
  while (layer.childElementCount < count) layer.appendChild(document.createElement("div")).className = "column-line";
  const lines = layer.children;
  for (let page = 0; page < pageCount; page++) {
    const top = contentTop(frame, page);
    const height = Math.max(0, contentBottom(frame, page) - top);
    for (let index = 0; index < columns.count - 1; index++) {
      const line = lines[page * (columns.count - 1) + index] as HTMLElement;
      const left = geometry.marginLeft + (index + 1) * columns.width + index * columns.gap + columns.gap / 2;
      line.style.left = `${round(left - 0.5)}px`;
      line.style.top = `${round(top)}px`;
      line.style.height = `${round(height)}px`;
    }
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
