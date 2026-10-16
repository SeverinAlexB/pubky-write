// Columns in print layout (Format > Columns, see docs/design/columns.md). The content is a CSS
// multi-column box; the pagination decides where every column ends and draws that with spacer
// widgets: forced column breaks within a page, and between pages a spacer across all columns
// (`column-span: all`) that ends the page's columns and reaches the next page's top margin.
//
// The browser balances the columns before a spanner, so each page gets exactly one forced break
// per column boundary, and an empty column is as tall as the page's tallest column. That leaves
// the browser no choice: every column holds what the pagination put there (an empty column of no
// height would leave balancing room to spread the columns before it). The last page ends the same way,
// with an empty spanner after the content, so its columns are balanced too rather than filled in
// order (`column-fill: auto`, which in Firefox puts everything in the first column).
//
// Firefox has no forced column breaks at all. There the content of every column but the tallest
// is followed by a filler that takes it to just under the tallest column, so balancing has to
// break the columns where the pagination did.
import { columnsOf, columnWidths, type PageGeometry } from "@docs/shared";
import type { Node } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { contentBottom, contentTop, type PageFrame, type Pagination } from "./pageLayout.ts";

/** The columns of the page in CSS pixels. */
export type ColumnGeometry = { count: number; width: number; gap: number; line: boolean };

export function columnGeometry(doc: Node, geometry: PageGeometry): ColumnGeometry {
  const settings = columnsOf(doc);
  const { width, gap } = columnWidths(settings, geometry.width - geometry.marginLeft - geometry.marginRight);
  return { count: settings.columns, width: round(width), gap: round(gap), line: settings.columnLine };
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

/**
 * A rendered spacer for columns: see RenderedSpacer in pagination.ts. `fill` is the height of the
 * empty columns its breaks start (with a spanner all of them, otherwise all but the last);
 * `endFill` the height of the filler that ends the column the spacer is in, without forced breaks.
 */
export type ColumnSpacer = Pagination["spacers"][number] & {
  height: number;
  breaks: number;
  spanner: boolean;
  after: number;
  fill: number;
  endFill: number;
  end?: boolean;
};

/** Whether the browser breaks columns where it is told to (`break-before: column`); Firefox does not. */
export function supportsColumnBreaks(): boolean {
  return typeof CSS !== "undefined" && CSS.supports("break-before", "column");
}

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
  end: number,
  forcedBreaks: boolean,
): ColumnSpacer[] {
  const columns = frame.columns ?? 1;
  const heights = pagination.slotHeights ?? [];
  const estimate = (page: number) => Math.max(0, ...heights.slice(page * columns, (page + 1) * columns).map((height) => height ?? 0));
  // 1px under the tallest column, so the next line cannot fit after the filler.
  const endFill = (slot: number, tallest: number) => (forcedBreaks ? 0 : round(Math.max(0, tallest - (heights[slot] ?? 0) - 1)));
  const lastSlot = pagination.lastSlot ?? 0;
  const lastHeight = estimate(Math.floor(lastSlot / columns));
  // After the content: the last page's remaining column breaks and an empty spanner.
  const ending: ColumnSpacer = {
    pos: end,
    shift: 0,
    inline: false,
    from: lastSlot,
    to: lastSlot,
    height: 0,
    breaks: columns - 1 - (lastSlot % columns),
    spanner: true,
    after: 0,
    fill: round(lastHeight),
    endFill: endFill(lastSlot, lastHeight),
    end: true,
  };
  const spacers = pagination.spacers.map((spacer): ColumnSpacer => {
    const from = spacer.from ?? 0;
    const to = spacer.to ?? from + 1;
    const fromPage = Math.floor(from / columns);
    const toPage = Math.floor(to / columns);
    if (fromPage === toPage) {
      const tallest = estimate(fromPage);
      return { ...spacer, height: 0, breaks: to - from, spanner: false, after: 0, fill: round(tallest), endFill: endFill(from, tallest) };
    }
    const columnsHeight = drawn.get(spacer.pos) ?? estimate(fromPage);
    const height = contentTop(frame, toPage) - contentTop(frame, fromPage) - columnsHeight - marginAt(spacer.pos, spacer.inline);
    // Without forced breaks the drawn columns are only right once the fillers are, so the fillers
    // are sized from the measured columns.
    const tallest = forcedBreaks ? columnsHeight : estimate(fromPage);
    return {
      ...spacer,
      height: Math.max(0, round(height)),
      breaks: columns - 1 - (from % columns),
      spanner: true,
      after: to % columns,
      fill: round(tallest),
      endFill: endFill(from, tallest),
    };
  });
  return [...spacers, ending];
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
