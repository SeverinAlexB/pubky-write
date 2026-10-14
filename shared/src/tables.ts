// Tables: the Tiptap table nodes with the attributes the editor stores, and the column layout
// shared by the editor, version history and the Word export.
//
// Column widths are kept in each cell's `colwidth` (one number per spanned column, in CSS pixels
// at the width the table had when they were set). They are shown as proportions of the content
// width, so a table always fills the page from margin to margin, whatever the page setup.
import { mergeAttributes } from "@tiptap/core";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import type { DOMOutputSpec, Node } from "@tiptap/pm/model";
import { TableMap } from "@tiptap/pm/tables";

/** The default border: 1px is 0.75pt. */
export const DEFAULT_TABLE_BORDER_WIDTH_PT = 0.75;
export const DEFAULT_TABLE_BORDER_COLOR = "#000000";

/** The table's stored column widths, by column; null where a column has none. */
export function storedColumnWidths(table: Node): (number | null)[] {
  const map = TableMap.get(table);
  const widths: (number | null)[] = Array.from({ length: map.width }, () => null);
  for (let row = 0; row < map.height; row++) {
    for (let column = 0; column < map.width; column++) {
      if (widths[column] !== null) continue;
      const cellPos = map.map[row * map.width + column]!;
      const cell = table.nodeAt(cellPos);
      const start = map.colCount(cellPos);
      const width = (cell?.attrs.colwidth as number[] | null | undefined)?.[column - start];
      if (typeof width === "number" && width > 0) widths[column] = width;
    }
  }
  return widths;
}

/**
 * Each column's share of the table width (they add up to 1). Columns are equal by default;
 * a column without a stored width, next to ones with widths, gets their average.
 */
export function columnFractions(table: Node): number[] {
  const widths = storedColumnWidths(table);
  const known = widths.filter((width): width is number => width !== null);
  const fallback = known.length > 0 ? known.reduce((sum, width) => sum + width, 0) / known.length : 1;
  const resolved = widths.map((width) => width ?? fallback);
  const total = resolved.reduce((sum, width) => sum + width, 0);
  return resolved.map((width) => width / total);
}

/** The `<col>` elements for a table, with widths in percent. */
export function columnSpecs(table: Node): DOMOutputSpec[] {
  return columnFractions(table).map((fraction) => ["col", { style: `width: ${percent(fraction)}` }]);
}

export function percent(fraction: number): string {
  return `${Math.round(fraction * 1e6) / 1e4}%`;
}

/** Inline style of a table: its border colour and width, read by the cells' borders. */
export function tableStyle(table: Node): string {
  const styles: string[] = [];
  if (table.attrs.borderColor) styles.push(`--table-border-color: ${table.attrs.borderColor}`);
  if (typeof table.attrs.borderWidth === "number") styles.push(`--table-border-width: ${table.attrs.borderWidth}pt`);
  return styles.join("; ");
}

export const DocsTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      borderColor: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-border-color"),
        rendered: false,
      },
      borderWidth: {
        default: null,
        parseHTML: (element) => numberOrNull(element.getAttribute("data-border-width")),
        rendered: false,
      },
    };
  },

  renderHTML({ node, HTMLAttributes }) {
    const style = tableStyle(node);
    return [
      "table",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        ...(style && { style }),
        ...(node.attrs.borderColor && { "data-border-color": node.attrs.borderColor }),
        ...(typeof node.attrs.borderWidth === "number" && { "data-border-width": String(node.attrs.borderWidth) }),
      }),
      ["colgroup", ...columnSpecs(node)],
      ["tbody", 0],
    ];
  },
  // The editor sets its own node view; read-only views and exports use renderHTML.
}).configure({ resizable: false, View: null });

/** Rows have a minimum height in CSS pixels (Distribute rows, Table options). */
export const DocsTableRow = TableRow.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      height: {
        default: null,
        parseHTML: (element) => numberOrNull(element.style.height),
        renderHTML: ({ height }) => (typeof height === "number" ? { style: `height: ${height}px` } : {}),
      },
    };
  },
});

const backgroundColor = {
  default: null,
  parseHTML: (element: HTMLElement) => element.getAttribute("data-background-color"),
  renderHTML: ({ backgroundColor }: Record<string, unknown>) =>
    typeof backgroundColor === "string"
      ? { style: `background-color: ${backgroundColor}`, "data-background-color": backgroundColor }
      : {},
};

export const DocsTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), backgroundColor };
  },
});

export const DocsTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), backgroundColor };
  },
});

function numberOrNull(value: string | null): number | null {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}
