// Format > Columns: the number of columns, the space between them and an optional line between
// them. They are attributes of the document node, like the page setup, so they apply to every
// page (and every document tab) and are saved, versioned and restored like any other edit.
// Insert > Break > Column break is a block node that moves the content after it to the next
// column. See docs/design/columns.md.
import { Extension, Node as TiptapNode } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { NodeSelection, Selection } from "@tiptap/pm/state";
import { PT_PER_CM } from "./pageSetup.ts";

export type ColumnSettings = {
  /** 1, 2 or 3. */
  columns: number;
  /** The space between two columns, in points. */
  columnSpacing: number;
  /** A 1px black line in the middle of the space between columns. */
  columnLine: boolean;
};

export const MAX_COLUMNS = 3;
/** 1.27 cm. */
export const DEFAULT_COLUMN_SPACING_PT = 36;
export const MAX_COLUMN_SPACING_PT = 72 * 3;

export const defaultColumnSettings: ColumnSettings = { columns: 1, columnSpacing: DEFAULT_COLUMN_SPACING_PT, columnLine: false };
export const columnKeys = Object.keys(defaultColumnSettings) as (keyof ColumnSettings)[];

export function isColumnCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_COLUMNS;
}

export function isColumnSpacing(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_COLUMN_SPACING_PT;
}

/** The column settings of a document; documents saved before columns existed have one column. */
export function columnsOf(doc: Node): ColumnSettings {
  const { columns, columnSpacing, columnLine } = doc.attrs;
  return {
    columns: isColumnCount(columns) ? columns : defaultColumnSettings.columns,
    columnSpacing: isColumnSpacing(columnSpacing) ? columnSpacing : DEFAULT_COLUMN_SPACING_PT,
    columnLine: columnLine === true,
  };
}

/** Spacing in centimetres, as the Column options dialog shows it (two decimals). */
export function columnSpacingCm(points: number): number {
  return Math.round((points / PT_PER_CM) * 100) / 100;
}

/** Adds the column attributes to the document node. */
export const ColumnAttributes = Extension.create({
  name: "columnAttributes",

  addGlobalAttributes() {
    return [
      {
        types: ["doc"],
        attributes: {
          columns: {
            default: defaultColumnSettings.columns,
            rendered: false,
            validate: (value: unknown) => {
              if (!isColumnCount(value)) throw new RangeError(`Invalid number of columns ${String(value)}`);
            },
          },
          columnSpacing: {
            default: DEFAULT_COLUMN_SPACING_PT,
            rendered: false,
            validate: (value: unknown) => {
              if (!isColumnSpacing(value)) throw new RangeError(`Invalid column spacing ${String(value)}`);
            },
          },
          columnLine: {
            default: false,
            rendered: false,
            validate: (value: unknown) => {
              if (typeof value !== "boolean") throw new RangeError("columnLine must be a boolean");
            },
          },
        },
      },
    ];
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    columnBreak: {
      insertColumnBreak: () => ReturnType;
    };
  }
}

/**
 * Insert > Break > Column break. On screen it is a dotted line; with more than one column the
 * pagination starts the next column after it. With one column it does nothing.
 */
export const ColumnBreak = TiptapNode.create({
  name: "columnBreak",
  group: "block",
  atom: true,
  selectable: true,

  parseHTML() {
    return [{ tag: 'div[data-type="column-break"]' }];
  },

  renderHTML() {
    return ["div", { "data-type": "column-break", class: "column-break", role: "separator", "aria-label": "Column break" }];
  },

  addCommands() {
    return {
      insertColumnBreak:
        () =>
        ({ chain }) =>
          chain()
            .insertContent({ type: this.name })
            // Continue typing after the break, as after a page break.
            .command(({ tr }) => {
              if (!(tr.selection instanceof NodeSelection) && tr.selection.$from.parent.isTextblock) return true;
              const after = tr.selection.to;
              if (!tr.doc.resolve(after).nodeAfter?.isTextblock) tr.insert(after, tr.doc.type.schema.nodes.paragraph!.create());
              tr.setSelection(Selection.near(tr.doc.resolve(after + 1)));
              return true;
            })
            .run(),
    };
  },
});
