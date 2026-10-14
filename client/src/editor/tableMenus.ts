// The table items of Format > Table and of the right-click menu inside a table.
import type { Editor } from "@tiptap/react";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { MenuEntry } from "../components/MenuList.tsx";
import type { EditorActions } from "./actions.ts";
import { distributeColumns, distributeRows, measureRowHeights, sortTable } from "./tables.ts";

export type TableMenuState = { canMerge: boolean; canUnmerge: boolean };

export function tableMenuState(editor: Editor): TableMenuState {
  if (!editor.isActive("table")) return { canMerge: false, canUnmerge: false };
  return { canMerge: editor.can().mergeCells(), canUnmerge: editor.can().splitCell() };
}

type Command = (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean;

function commands(editor: Editor) {
  const run = () => editor.chain().focus();
  const apply = (command: Command) => {
    command(editor.state, editor.view.dispatch);
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
    mergeCells: () => run().mergeCells().run(),
    unmergeCells: () => run().splitCell().run(),
    sortAscending: () => apply(sortTable("ascending")),
    sortDescending: () => apply(sortTable("descending")),
  };
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
    { label: "Table options", icon: "table", onSelect: actions.tableOptions },
  ];
}
