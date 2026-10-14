// Tables in the pagination: a table breaks between its rows (never inside a row, nor between rows
// joined by a merged cell), and on every page it continues to, its pinned rows are repeated above
// the first row (see pagination.ts).
import type { Node } from "@tiptap/pm/model";
import { TableMap } from "@tiptap/pm/tables";
import type { LayoutLine } from "./pageLayout.ts";

/** A row is a header row when all its cells are header cells. */
export function isHeaderRow(row: Node): boolean {
  let header = row.childCount > 0;
  row.forEach((cell) => {
    if (cell.type.spec.tableRole !== "header_cell") header = false;
  });
  return header;
}

/** The number of pinned rows: the header rows at the top of the table (never all of its rows). */
export function pinnedRowCount(table: Node): number {
  let count = 0;
  while (count < table.childCount && isHeaderRow(table.child(count))) count++;
  return count === table.childCount ? 0 : count;
}

/** Identifies the content of the pinned rows, so their copies are drawn again when it changes. */
export function pinnedRowsKey(table: Node): string {
  const count = pinnedRowCount(table);
  let key = String(count);
  for (let index = 0; index < count; index++) key += `|${hash(JSON.stringify(table.child(index).toJSON()))}`;
  return key;
}

function hash(text: string): string {
  let value = 0;
  for (let index = 0; index < text.length; index++) value = (Math.imul(value, 31) + text.charCodeAt(index)) | 0;
  return (value >>> 0).toString(36);
}

/**
 * The places a table can break: one "line" per row, or per group of rows joined by cells merged
 * across them. `rows` are the drawn rows in order; `toNatural` turns client y into layout y.
 */
export function tableRowLines(table: Node, tablePos: number, rows: HTMLElement[], toNatural: (clientY: number) => number): LayoutLine[] {
  if (rows.length !== table.childCount) return [];
  const map = TableMap.get(table);
  const pinned = pinnedRowCount(table);
  const rects = rows.map((row) => row.getBoundingClientRect());
  const carry = pinned > 0 ? toNatural(rects[pinned - 1]!.bottom) - toNatural(rects[0]!.top) : 0;
  const lines: LayoutLine[] = [];
  let offset = tablePos + 1;
  for (let index = 0; index < table.childCount; index++) {
    const start = offset;
    offset += table.child(index).nodeSize;
    const top = toNatural(rects[index]!.top);
    const bottom = toNatural(rects[index]!.bottom);
    const continues = index > 0 && Array.from({ length: map.width }, (_, column) => column).some(
      (column) => map.map[index * map.width + column] === map.map[(index - 1) * map.width + column],
    );
    const previous = lines.at(-1);
    if (previous && continues) {
      previous.bottom = Math.max(previous.bottom, bottom);
      continue;
    }
    lines.push({ top, bottom, start: () => start, ...(index >= pinned && carry > 0 && { carry }) });
  }
  return lines;
}
