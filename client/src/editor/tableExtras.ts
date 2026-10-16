// Split cell, Pin header row / Unpin header rows and Insert title row (spec 19). Every command
// changes the table with steps that keep the content of the existing cells (attribute changes and
// inserted cells or rows), so comments in the table keep their places, and is one undo step.
//
// Pinned rows are the header rows at the top of the table (rows whose cells are all header cells).
// Word's "repeat as header row" rows are the same thing, so they export and import as such.
import { storedColumnWidths } from "@pubky-write/shared";
import { closeHistory } from "./tabHistory.ts";
import type { Node, NodeType } from "@tiptap/pm/model";
import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { isInTable, selectedRect } from "@tiptap/pm/tables";
import { isHeaderRow } from "./tableLayout.ts";

type Command = (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean;

/** The most columns or rows Split cell makes. */
export const MAX_SPLIT = 20;

/** A cell of the table's grid: where it starts and how many columns and rows it covers. */
type GridCell = { left: number; top: number; colspan: number; rowspan: number; node: Node | null; original: number | null };

/** The cell at the cursor (its top left corner in the grid). */
function cursorCell(state: EditorState) {
  const rect = selectedRect(state);
  const cellPos = rect.map.map[rect.top * rect.map.width + rect.left]!;
  return { rect, cellPos, cell: rect.table.nodeAt(cellPos)!, cellRect: rect.map.findCell(cellPos) };
}

/**
 * Split cell: divides the cell at the cursor into `columns` × `rows` cells. A cell merged across
 * columns or rows is divided within its area; where more columns or rows are needed, they are
 * added, and the other cells of those columns and rows span them to keep the table rectangular.
 */
export function splitCellInto(columns: number, rows: number): Command {
  return (state, dispatch) => {
    if (!isInTable(state)) return false;
    if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1 || columns > MAX_SPLIT || rows > MAX_SPLIT) return false;
    const { rect, cellPos, cell, cellRect } = cursorCell(state);
    const { table, map, tableStart } = rect;
    const spanX = cellRect.right - cellRect.left;
    const spanY = cellRect.bottom - cellRect.top;
    if (columns === 1 && rows === 1 && spanX === 1 && spanY === 1) return false;
    if (!dispatch) return true;

    const addColumns = Math.max(0, columns - spanX);
    const addRows = Math.max(0, rows - spanY);
    const columnAt = cellRect.right; // new columns go after the cell's last column
    const rowAt = cellRect.bottom; // new rows after its last row

    // The grid after the split.
    const grid: GridCell[] = [];
    const seen = new Set<number>();
    for (const pos of map.map) {
      if (seen.has(pos) || pos === cellPos) continue;
      seen.add(pos);
      const found = map.findCell(pos);
      const node = table.nodeAt(pos)!;
      let { left, top } = found;
      let colspan = found.right - found.left;
      let rowspan = found.bottom - found.top;
      if (left < columnAt && found.right >= columnAt) colspan += addColumns;
      else if (left >= columnAt) left += addColumns;
      if (top < rowAt && found.bottom >= rowAt) rowspan += addRows;
      else if (top >= rowAt) top += addRows;
      grid.push({ left, top, colspan, rowspan, node, original: pos });
    }
    const pieceWidths = shares(spanX + addColumns, columns);
    const pieceHeights = shares(spanY + addRows, rows);
    let pieceTop = cellRect.top;
    pieceHeights.forEach((rowspan, rowIndex) => {
      let pieceLeft = cellRect.left;
      pieceWidths.forEach((colspan, columnIndex) => {
        const first = rowIndex === 0 && columnIndex === 0;
        grid.push({ left: pieceLeft, top: pieceTop, colspan, rowspan, node: first ? cell : null, original: first ? cellPos : null });
        pieceLeft += colspan;
      });
      pieceTop += rowspan;
    });

    // Column widths: the cell's last column is shared by the columns made from it.
    const oldWidths = storedColumnWidths(table);
    const split = oldWidths[columnAt - 1] ?? null;
    const widths = [
      ...oldWidths.slice(0, columnAt - 1),
      ...Array.from({ length: addColumns + 1 }, () => (split === null ? null : Math.max(1, Math.round(split / (addColumns + 1))))),
      ...oldWidths.slice(columnAt),
    ];
    const colwidth = (piece: GridCell) => {
      const slice = widths.slice(piece.left, piece.left + piece.colspan);
      return slice.every((width): width is number => width !== null) ? slice : null;
    };

    const tr = closeHistory(state.tr);
    // Existing cells keep their content: only their spans and widths change.
    for (const piece of grid) {
      if (piece.original === null) continue;
      const node = table.nodeAt(piece.original)!;
      const attrs = { ...node.attrs, colspan: piece.colspan, rowspan: piece.rowspan, colwidth: colwidth(piece) };
      if (JSON.stringify(attrs) !== JSON.stringify(node.attrs)) tr.setNodeMarkup(tableStart + piece.original, undefined, attrs);
    }
    const newCell = (piece: GridCell) =>
      cell.type.createAndFill({ ...cell.attrs, colspan: piece.colspan, rowspan: piece.rowspan, colwidth: colwidth(piece) })!;
    // New rows, with the parts of the cell that start in them.
    if (addRows > 0) {
      let after = tableStart;
      for (let index = 0; index < rowAt; index++) after += table.child(index).nodeSize;
      const rowType = table.child(0).type;
      const newRows = Array.from({ length: addRows }, (_, offset) =>
        rowType.create(
          null,
          grid
            .filter((piece) => piece.original === null && piece.top === rowAt + offset)
            .sort((a, b) => a.left - b.left)
            .map(newCell),
        ),
      );
      tr.insert(tr.mapping.map(after), newRows);
    }
    // The other parts, into the existing rows, left to right.
    const pieces = grid.filter((piece) => piece.original === null && (piece.top < rowAt || addRows === 0)).sort((a, b) => a.top - b.top || a.left - b.left);
    for (const piece of pieces) {
      const tableNode = tr.doc.nodeAt(tableStart - 1)!;
      let rowPos = tableStart;
      for (let index = 0; index < piece.top; index++) rowPos += tableNode.child(index).nodeSize;
      const before = grid.filter((other) => other.top === piece.top && other.left < piece.left && (other.original !== null || pieces.indexOf(other) < pieces.indexOf(piece)));
      const rowNode = tableNode.child(piece.top);
      let pos = rowPos + 1;
      for (let index = 0; index < before.length && index < rowNode.childCount; index++) pos += rowNode.child(index).nodeSize;
      tr.insert(pos, newCell(piece));
    }
    // The cursor stays at the start of the first part, which has the cell's content.
    tr.setSelection(TextSelection.near(tr.doc.resolve(tr.mapping.map(tableStart + cellPos) + 1)));
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/** `total` divided into `parts` whole numbers, the larger ones first. */
function shares(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  return Array.from({ length: parts }, (_, index) => base + (index < total % parts ? 1 : 0));
}

/** How many rows at the top of the table are header rows. */
export function headerRowCount(table: Node): number {
  let count = 0;
  while (count < table.childCount && isHeaderRow(table.child(count))) count++;
  return count;
}

/** The pinned rows of the table at the cursor and the cursor's row, for the menus. */
export function pinState(state: EditorState): { pinned: number; row: number } | null {
  if (!isInTable(state)) return null;
  const { rect } = cursorCell(state);
  return { pinned: headerRowCount(rect.table), row: rect.top };
}

/** Makes every cell of the rows from `from` to `to` (exclusive) a header cell or a normal cell. */
function setRowsCellType(tr: Transaction, table: Node, tableStart: number, from: number, to: number, type: NodeType): void {
  table.forEach((row, offset, index) => {
    const rowPos = tableStart + offset;
    if (index < from || index >= to) return;
    row.forEach((cell, cellOffset) => {
      if (cell.type !== type) tr.setNodeMarkup(rowPos + 1 + cellOffset, type, cell.attrs);
    });
  });
}

/** Pin header row: the rows from the top to the cursor's row become pinned (header) rows. */
export const pinHeaderRows: Command = (state, dispatch) => {
  if (!isInTable(state)) return false;
  const { rect } = cursorCell(state);
  const header = state.schema.nodes.tableHeader!;
  if (dispatch) {
    const tr = closeHistory(state.tr);
    setRowsCellType(tr, rect.table, rect.tableStart, 0, rect.top + 1, header);
    dispatch(tr);
  }
  return true;
};

/** Unpin header rows: every pinned row becomes a normal row. */
export const unpinHeaderRows: Command = (state, dispatch) => {
  if (!isInTable(state)) return false;
  const { rect } = cursorCell(state);
  const count = headerRowCount(rect.table);
  if (count === 0) return false;
  if (dispatch) {
    const tr = closeHistory(state.tr);
    setRowsCellType(tr, rect.table, rect.tableStart, 0, count, state.schema.nodes.tableCell!);
    dispatch(tr);
  }
  return true;
};

/** Insert title row: an empty pinned row at the top of the table, with the cursor in it. */
export const insertTitleRow: Command = (state, dispatch) => {
  if (!isInTable(state)) return false;
  const { rect } = cursorCell(state);
  if (dispatch) {
    const widths = storedColumnWidths(rect.table);
    const header = state.schema.nodes.tableHeader!;
    const cells = widths.map((width) => header.createAndFill({ colwidth: width === null ? null : [width] })!);
    const row = rect.table.child(0).type.create(null, cells);
    const tr = closeHistory(state.tr).insert(rect.tableStart, row);
    tr.setSelection(TextSelection.near(tr.doc.resolve(rect.tableStart + 2)));
    dispatch(tr.scrollIntoView());
  }
  return true;
};
