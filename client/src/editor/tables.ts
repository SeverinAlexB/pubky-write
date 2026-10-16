// Tables in the editor: the node view with proportional columns, dragging column borders, and
// the Format > Table and right-click commands that prosemirror-tables does not have.
import { columnFractions, DocsTable, percent, tableStyle } from "@pubky-write/shared";
import { Extension } from "@tiptap/core";
import { closeHistory } from "./tabHistory.ts";
import { Fragment, type Node } from "@tiptap/pm/model";
import { Plugin, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { isInTable, selectedRect, TableMap } from "@tiptap/pm/tables";
import type { EditorView, NodeView, ViewMutationRecord } from "@tiptap/pm/view";
import { isHeaderRow } from "./tableLayout.ts";
import { clientRect } from "./rects.ts";

/** The narrowest a column can be dragged, in CSS pixels. */
export const MIN_COLUMN_WIDTH = 20;
/** How close to a column border the pointer has to be to drag it, in screen pixels. */
const BORDER_HANDLE = 4;

/** Draws a table with its stored column widths as percentages, so it always fills the content width. */
export class DocsTableView implements NodeView {
  dom: HTMLDivElement;
  table: HTMLTableElement;
  colgroup: HTMLTableColElement;
  contentDOM: HTMLTableSectionElement;

  constructor(public node: Node) {
    this.dom = document.createElement("div");
    this.dom.className = "tableWrapper";
    this.table = this.dom.appendChild(document.createElement("table"));
    this.colgroup = this.table.appendChild(document.createElement("colgroup"));
    this.contentDOM = this.table.appendChild(document.createElement("tbody"));
    this.render();
  }

  update(node: Node): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    // Changes outside the cells are this view's own (column widths while dragging).
    return mutation.type !== "selection" && !this.contentDOM.contains(mutation.target);
  }

  private render() {
    const fractions = columnFractions(this.node);
    while (this.colgroup.childElementCount > fractions.length) this.colgroup.lastElementChild!.remove();
    while (this.colgroup.childElementCount < fractions.length) this.colgroup.appendChild(document.createElement("col"));
    fractions.forEach((fraction, index) => {
      const col = this.colgroup.children[index] as HTMLTableColElement;
      const width = percent(fraction);
      if (col.style.width !== width) col.style.width = width;
    });
    const style = tableStyle(this.node);
    if (this.table.getAttribute("style") !== style) this.table.setAttribute("style", style);
  }
}

/** The table extension of the editor: the shared table with the node view above. */
export const EditorTable = DocsTable.configure({ View: DocsTableView });

/** Sets every column's width (CSS pixels, by column), as an undo step of its own. */
export function setColumnWidths(tr: Transaction, tablePos: number, widths: number[]): Transaction {
  const table = tr.doc.nodeAt(tablePos);
  if (!table) return tr;
  closeHistory(tr);
  const map = TableMap.get(table);
  const seen = new Set<number>();
  for (const cellPos of map.map) {
    if (seen.has(cellPos)) continue;
    seen.add(cellPos);
    const cell = table.nodeAt(cellPos)!;
    const start = map.colCount(cellPos);
    const colwidth = widths.slice(start, start + (cell.attrs.colspan as number));
    tr.setNodeAttribute(tablePos + 1 + cellPos, "colwidth", colwidth);
  }
  return tr;
}

type Command = (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean;

/** Distribute columns: makes all columns equally wide (they then have no stored width). */
export const distributeColumns: Command = (state, dispatch) => {
  if (!isInTable(state)) return false;
  const { table, tableStart } = selectedRect(state);
  if (dispatch) {
    const tr = closeHistory(state.tr);
    table.descendants((node, pos) => {
      if (node.type.spec.tableRole === "cell" || node.type.spec.tableRole === "header_cell") {
        if (node.attrs.colwidth) tr.setNodeAttribute(tableStart + pos, "colwidth", null);
        return false;
      }
      return true;
    });
    dispatch(tr);
  }
  return true;
};

/**
 * Distribute rows: gives every row the height of the tallest, given the rows' current heights
 * in CSS pixels (measured by the caller).
 */
export function distributeRows(rowHeights: number[]): Command {
  return (state, dispatch) => {
    if (!isInTable(state)) return false;
    const { table, tableStart } = selectedRect(state);
    if (rowHeights.length !== table.childCount) return false;
    const height = Math.round(Math.max(...rowHeights));
    if (dispatch) {
      const tr = closeHistory(state.tr);
      table.forEach((row, offset) => {
        if (row.attrs.height !== height) tr.setNodeAttribute(tableStart + offset, "height", height);
      });
      dispatch(tr);
    }
    return true;
  };
}

/** The heights of the rows of the table at the cursor, in CSS pixels, read from the page. */
export function measureRowHeights(view: EditorView): number[] {
  if (!isInTable(view.state)) return [];
  const { tableStart } = selectedRect(view.state);
  const wrapper = view.nodeDOM(tableStart - 1);
  if (!(wrapper instanceof HTMLElement)) return [];
  return Array.from(wrapper.querySelectorAll<HTMLTableRowElement>(":scope tbody > tr:not(.table-size-row)")).map((row) => row.offsetHeight);
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Compares cell texts for sorting: numbers by value, text alphabetically, empty cells last. */
export function compareCellText(a: string, b: string, direction: "ascending" | "descending"): number {
  const [left, right] = [a.trim(), b.trim()];
  if (!left || !right) return Number(!left) - Number(!right);
  const order = collator.compare(left, right);
  return direction === "ascending" ? order : -order;
}

/**
 * Sort ascending or descending: orders the rows by the text of the cursor's column, in one undo
 * step. Header rows at the top stay in place. Tables with cells merged across rows cannot be sorted.
 */
export function sortTable(direction: "ascending" | "descending"): Command {
  return (state, dispatch) => {
    if (!isInTable(state)) return false;
    const rect = selectedRect(state);
    const { table, tableStart, map } = rect;
    let mergedRows = false;
    table.forEach((row) =>
      row.forEach((cell) => {
        if ((cell.attrs.rowspan as number) > 1) mergedRows = true;
      }),
    );
    if (mergedRows) return false;

    const rows = Array.from({ length: table.childCount }, (_, index) => ({ index, row: table.child(index) }));
    const pinned = rows.findIndex(({ row }) => !isHeaderRow(row));
    if (pinned === -1) return false;
    const keyOf = (index: number) => table.nodeAt(map.map[index * map.width + rect.left]!)!.textContent;
    const sorted = [
      ...rows.slice(0, pinned),
      ...rows.slice(pinned).sort((a, b) => compareCellText(keyOf(a.index), keyOf(b.index), direction) || a.index - b.index),
    ];
    // Already in order: nothing to change (and nothing to undo).
    if (!dispatch || sorted.every(({ index }, position) => index === position)) return true;

    // Keep the cursor in the same cell, wherever its row went.
    const { $head } = state.selection;
    const cellPos = map.map[rect.top * map.width + rect.left]!;
    const offsetInCell = Math.max(0, $head.pos - (tableStart + cellPos));
    // An undo step of its own, not merged with the typing before it.
    const tr = closeHistory(state.tr).replaceWith(tableStart, tableStart + table.content.size, Fragment.from(sorted.map(({ row }) => row)));
    const newRow = sorted.findIndex(({ index }) => index === rect.top);
    const newTable = tr.doc.nodeAt(tableStart - 1)!;
    const newCellPos = TableMap.get(newTable).map[newRow * map.width + rect.left]!;
    const cell = newTable.nodeAt(newCellPos)!;
    const target = tableStart + newCellPos + Math.min(offsetInCell, cell.nodeSize - 1);
    tr.setSelection(TextSelection.near(tr.doc.resolve(target)));
    dispatch(tr.scrollIntoView());
    return true;
  };
}


/** The size of the table at the cursor, for Table options. */
export function tableSizeAt(state: EditorState): { columns: number; rows: number } | null {
  if (!isInTable(state)) return null;
  const { map } = selectedRect(state);
  return { columns: map.width, rows: map.height };
}

type Boundary = { tablePos: number; column: number };

/** The column border under the pointer: `column` is the column left of it. Not the table's outer edges. */
function boundaryAt(view: EditorView, event: MouseEvent): Boundary | null {
  const cell = (event.target as Element | null)?.closest?.("td, th");
  if (!(cell instanceof HTMLElement) || !view.dom.contains(cell)) return null;
  const rect = clientRect(cell);
  const nearRight = Math.abs(event.clientX - rect.right) <= BORDER_HANDLE;
  const nearLeft = Math.abs(event.clientX - rect.left) <= BORDER_HANDLE;
  if (!nearRight && !nearLeft) return null;
  let $cell;
  try {
    $cell = view.state.doc.resolve(view.posAtDOM(cell, 0));
  } catch {
    return null;
  }
  for (let depth = $cell.depth; depth > 0; depth--) {
    const role = $cell.node(depth).type.spec.tableRole;
    if (role !== "cell" && role !== "header_cell") continue;
    const table = $cell.node(depth - 2);
    const tableStart = $cell.start(depth - 2);
    const map = TableMap.get(table);
    const start = map.colCount($cell.before(depth) - tableStart);
    const column = nearRight ? start + ($cell.node(depth).attrs.colspan as number) - 1 : start - 1;
    if (column < 0 || column >= map.width - 1) return null;
    return { tablePos: tableStart - 1, column };
  }
  return null;
}

/**
 * Dragging the border between two columns: the pointer shows `col-resize` over a border, and
 * dragging moves width from one neighbour to the other, so the table keeps its width. All
 * column widths are stored on release, as one undo step.
 */
function columnResizing(): Plugin {
  let hover: Boundary | null = null;
  let dragging = false;

  const setHover = (view: EditorView, boundary: Boundary | null) => {
    hover = boundary;
    view.dom.classList.toggle("is-column-resize", boundary !== null);
  };

  const startDrag = (view: EditorView, event: MouseEvent, { tablePos, column }: Boundary) => {
    const tableNode = view.state.doc.nodeAt(tablePos);
    const wrapper = view.nodeDOM(tablePos);
    const table = wrapper instanceof HTMLElement ? wrapper.querySelector("table") : null;
    if (!tableNode || !table) return false;
    const cols = Array.from(table.querySelectorAll<HTMLTableColElement>(":scope > colgroup > col"));
    // A table broken into columns draws no box of its own (see pagination.ts): its wrapper is as wide.
    const sized = table.offsetWidth > 0 ? table : (wrapper as HTMLElement);
    const tableWidth = sized.offsetWidth;
    // CSS pixels per screen pixel, under the editor's zoom.
    const scale = tableWidth / sized.getBoundingClientRect().width || 1;
    const widths = columnFractions(tableNode).map((fraction) => fraction * tableWidth);
    const pair = widths[column]! + widths[column + 1]!;
    const startX = event.clientX;
    let left = widths[column]!;
    dragging = true;
    document.body.classList.add("is-column-resizing");

    const move = (moveEvent: MouseEvent) => {
      const wanted = widths[column]! + (moveEvent.clientX - startX) * scale;
      left = Math.min(Math.max(wanted, MIN_COLUMN_WIDTH), pair - MIN_COLUMN_WIDTH);
      cols[column]?.style.setProperty("width", percent(left / tableWidth));
      cols[column + 1]?.style.setProperty("width", percent((pair - left) / tableWidth));
    };
    const finish = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", finish);
      dragging = false;
      document.body.classList.remove("is-column-resizing");
      if (Math.abs(left - widths[column]!) < 0.5) return;
      const next = widths.map((width, index) => (index === column ? left : index === column + 1 ? pair - left : width));
      view.dispatch(setColumnWidths(view.state.tr, tablePos, next.map((width) => Math.round(width))));
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", finish);
    return true;
  };

  return new Plugin({
    props: {
      handleDOMEvents: {
        mousemove: (view, event) => {
          if (!dragging && view.editable) setHover(view, boundaryAt(view, event));
          return false;
        },
        mouseleave: (view) => {
          if (!dragging) setHover(view, null);
          return false;
        },
        mousedown: (view, event) => {
          if (event.button !== 0 || !hover || !view.editable) return false;
          const boundary = hover;
          setHover(view, null);
          if (!startDrag(view, event, boundary)) return false;
          event.preventDefault();
          return true;
        },
      },
    },
  });
}

export const TableColumnResize = Extension.create({
  name: "tableColumnResize",
  addProseMirrorPlugins: () => [columnResizing()],
});
