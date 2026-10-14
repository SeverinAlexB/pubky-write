// The table items of Format > Table and of the right-click menu inside a table.
import type { Editor } from "@tiptap/react";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { MenuEntry } from "../components/MenuList.tsx";
import type { EditorActions } from "./actions.ts";
import { insertTitleRow, pinHeaderRows, pinState, unpinHeaderRows } from "./tableExtras.ts";
import { applyDirectly } from "./suggesting.ts";
import { distributeColumns, distributeRows, measureRowHeights, sortTable } from "./tables.ts";

/** `pinned`: the cursor is in a pinned row, so the menus offer Unpin header rows. */
export type TableMenuState = { canMerge: boolean; canUnmerge: boolean; pinned: boolean };

export function tableMenuState(editor: Editor): TableMenuState {
  if (!editor.isActive("table")) return { canMerge: false, canUnmerge: false, pinned: false };
  const pin = pinState(editor.state);
  return {
    canMerge: editor.can().mergeCells(),
    canUnmerge: editor.can().splitCell(),
    pinned: pin !== null && pin.row < pin.pinned,
  };
}

type Command = (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean;

function commands(editor: Editor) {
  const run = () => editor.chain().focus();
  /** Merging, splitting and sorting change cells and rows directly, also in Suggesting mode. */
  const direct = () => run().command(({ tr }) => Boolean(applyDirectly(tr)));
  const apply = (command: Command, directly = false) => {
    command(editor.state, (tr) => editor.view.dispatch(directly ? applyDirectly(tr) : tr));
    editor.commands.focus();
  };
  return {
    insertRowAbove: () => run().addRowBefore().run(),
    insertRowBelow: () => run().addRowAfter().run(),
    insertColumnLeft: () => run().addColumnBefore().run(),
    insertColumnRight: () => run().addColumnAfter().run(),
    deleteRow: () => run().deleteRow().run(),
    deleteColumn: () => run().deleteColumn().run(),
    deleteTable: () => run().deleteTable().run(),
    distributeRows: () => apply(distributeRows(measureRowHeights(editor.view))),
    distributeColumns: () => apply(distributeColumns),
    mergeCells: () => direct().mergeCells().run(),
    unmergeCells: () => direct().splitCell().run(),
    sortAscending: () => apply(sortTable("ascending"), true),
    sortDescending: () => apply(sortTable("descending"), true),
    pinHeaderRows: () => apply(pinHeaderRows),
    unpinHeaderRows: () => apply(unpinHeaderRows),
    insertTitleRow: () => apply(insertTitleRow),
  };
}

/** Pin header row (the rows up to the cursor's), or Unpin header rows in a pinned row. */
function pinEntry(table: ReturnType<typeof commands>, state: TableMenuState): MenuEntry {
  return state.pinned
    ? { label: "Unpin header rows", icon: "keep_off", onSelect: table.unpinHeaderRows }
    : { label: "Pin header row", icon: "keep", onSelect: table.pinHeaderRows };
}

/** Format > Table. */
export function formatTableMenu(editor: Editor, actions: EditorActions, state: TableMenuState): MenuEntry[] {
  const table = commands(editor);
  return [
    { label: "Insert row above", onSelect: table.insertRowAbove },
    { label: "Insert row below", onSelect: table.insertRowBelow },
    { label: "Insert column left", onSelect: table.insertColumnLeft },
    { label: "Insert column right", onSelect: table.insertColumnRight },
    "separator",
    { label: "Delete row", onSelect: table.deleteRow },
    { label: "Delete column", onSelect: table.deleteColumn },
    { label: "Delete table", onSelect: table.deleteTable },
    "separator",
    { label: "Distribute rows", onSelect: table.distributeRows },
    { label: "Distribute columns", onSelect: table.distributeColumns },
    "separator",
    { label: "Merge cells", disabled: !state.canMerge, onSelect: table.mergeCells },
    { label: "Unmerge cells", disabled: !state.canUnmerge, onSelect: table.unmergeCells },
    { label: "Split cell", onSelect: actions.splitCell },
    "separator",
    pinEntry(table, state),
    { label: "Insert title row", onSelect: table.insertTitleRow },
    "separator",
    { label: "Sort ascending", icon: "arrow_upward", onSelect: table.sortAscending },
    { label: "Sort descending", icon: "arrow_downward", onSelect: table.sortDescending },
    "separator",
    { label: "Table options", icon: "table", onSelect: actions.tableOptions },
  ];
}

/** The table group of the right-click menu. */
export function contextTableMenu(editor: Editor, actions: EditorActions): MenuEntry[] {
  const table = commands(editor);
  const state = tableMenuState(editor);
  return [
    { label: "Insert row above", icon: "add", onSelect: table.insertRowAbove },
    { label: "Insert row below", icon: "add", onSelect: table.insertRowBelow },
    { label: "Insert column to the left", icon: "add", onSelect: table.insertColumnLeft },
    { label: "Insert column to the right", icon: "add", onSelect: table.insertColumnRight },
    "separator",
    { label: "Delete row", icon: "delete", onSelect: table.deleteRow },
    { label: "Delete column", icon: "delete", onSelect: table.deleteColumn },
    { label: "Delete table", icon: "delete", onSelect: table.deleteTable },
    "separator",
    { label: "Distribute rows", icon: "table_rows", onSelect: table.distributeRows },
    { label: "Distribute columns", icon: "view_column", onSelect: table.distributeColumns },
    {
      label: "Sort table",
      icon: "sort",
      submenu: [
        { label: "Sort ascending", icon: "arrow_upward", onSelect: table.sortAscending },
        { label: "Sort descending", icon: "arrow_downward", onSelect: table.sortDescending },
      ],
    },
    pinEntry(table, state),
    { label: "Split cell", icon: "call_split", onSelect: actions.splitCell },
    { label: "Insert title row", icon: "title", onSelect: table.insertTitleRow },
    { label: "Table options", icon: "table", onSelect: actions.tableOptions },
  ];
}
