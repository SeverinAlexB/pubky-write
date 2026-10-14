import { documentSchema } from "@docs/shared";
import { history, undo } from "@tiptap/pm/history";
import { Node } from "@tiptap/pm/model";
import { EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";
import { TableMap } from "@tiptap/pm/tables";
import { describe, expect, it } from "vitest";
import { headerRowCount, insertTitleRow, pinHeaderRows, splitCellInto, unpinHeaderRows } from "./tableExtras.ts";
import { pinnedRowCount, pinnedRowsKey } from "./tableLayout.ts";

const cell = (value: string, attrs?: Record<string, unknown>, type = "tableCell") => ({
  type,
  ...(attrs && { attrs }),
  content: [{ type: "paragraph", content: value ? [{ type: "text", text: value }] : [] }],
});
const row = (...cells: unknown[]) => ({ type: "tableRow", content: cells });

function tableState(rows: unknown[]): EditorState {
  const doc = Node.fromJSON(documentSchema, { type: "doc", content: [{ type: "table", content: rows }, { type: "paragraph" }] });
  return EditorState.create({ doc, plugins: [history()] });
}

function cursorIn(state: EditorState, text: string): EditorState {
  let found = -1;
  state.doc.descendants((node, pos) => {
    if (found === -1 && node.isText && node.text === text) found = pos;
  });
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, found)));
}

function run(state: EditorState, command: (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean) {
  let result = state;
  const applied = command(state, (tr) => (result = state.apply(tr)));
  return { applied, state: result };
}

/** The table as a grid of cell texts (a merged cell repeats its text in every square it covers). */
function grid(state: EditorState): string[][] {
  const table = state.doc.child(0);
  const map = TableMap.get(table);
  return Array.from({ length: map.height }, (_, rowIndex) =>
    Array.from({ length: map.width }, (_, column) => table.nodeAt(map.map[rowIndex * map.width + column]!)!.textContent),
  );
}

const cellCount = (state: EditorState) => {
  let count = 0;
  state.doc.child(0).forEach((tableRow) => (count += tableRow.childCount));
  return count;
};

const twoByTwo = [row(cell("A"), cell("B")), row(cell("C"), cell("D"))];

describe("splitCellInto", () => {
  it("splits a cell into 2 × 2: four cells, the other cells of its row and column span the new ones", () => {
    const { applied, state } = run(cursorIn(tableState(twoByTwo), "A"), splitCellInto(2, 2));
    expect(applied).toBe(true);
    state.doc.check();
    expect(grid(state)).toEqual([
      ["A", "", "B"],
      ["", "", "B"],
      ["C", "C", "D"],
    ]);
    // A, its three new neighbours, B, C and D.
    expect(cellCount(state)).toBe(7);
    // The cursor is in the first part, which keeps the content.
    expect(state.selection.$from.parent.textContent).toBe("A");
  });

  it("divides a merged cell within its area", () => {
    const merged = [row(cell("AB", { colspan: 2 })), row(cell("C"), cell("D"))];
    const { state } = run(cursorIn(tableState(merged), "AB"), splitCellInto(2, 1));
    expect(grid(state)).toEqual([
      ["AB", ""],
      ["C", "D"],
    ]);
    expect(cellCount(state)).toBe(4);
  });

  it("shares the split column's width between the new columns", () => {
    const widths = [row(cell("A", { colwidth: [200] }), cell("B", { colwidth: [100] }))];
    const { state } = run(cursorIn(tableState(widths), "A"), splitCellInto(2, 1));
    const cells: unknown[] = [];
    state.doc.child(0).child(0).forEach((tableCell) => cells.push(tableCell.attrs.colwidth));
    expect(cells).toEqual([[100], [100], [100]]);
  });

  it("keeps the other cells' content and is one undo step", () => {
    const start = cursorIn(tableState(twoByTwo), "D");
    const { state } = run(start, splitCellInto(1, 3));
    expect(grid(state)).toEqual([
      ["A", "B"],
      ["C", "D"],
      ["C", ""],
      ["C", ""],
    ]);
    const undone = run(state, undo).state;
    expect(undone.doc.eq(start.doc)).toBe(true);
  });

  it("does nothing for 1 × 1 or outside a table", () => {
    expect(run(cursorIn(tableState(twoByTwo), "A"), splitCellInto(1, 1)).applied).toBe(false);
    const doc = Node.fromJSON(documentSchema, { type: "doc", content: [{ type: "paragraph" }] });
    expect(splitCellInto(2, 2)(EditorState.create({ doc }))).toBe(false);
  });
});

describe("pinned header rows", () => {
  const rows = [row(cell("Name"), cell("Age")), row(cell("Ann"), cell("30")), row(cell("Bob"), cell("40"))];

  it("pins the rows up to the cursor's and unpins them", () => {
    const pinned = run(cursorIn(tableState(rows), "Ann"), pinHeaderRows).state;
    expect(headerRowCount(pinned.doc.child(0))).toBe(2);
    expect(pinnedRowCount(pinned.doc.child(0))).toBe(2);
    expect(grid(pinned)).toEqual(grid(tableState(rows)));
    const unpinned = run(pinned, unpinHeaderRows).state;
    expect(headerRowCount(unpinned.doc.child(0))).toBe(0);
  });

  it("never counts every row of a table as pinned rows to repeat", () => {
    const all = run(cursorIn(tableState(rows), "Bob"), pinHeaderRows).state;
    expect(headerRowCount(all.doc.child(0))).toBe(3);
    expect(pinnedRowCount(all.doc.child(0))).toBe(0);
  });

  it("identifies the pinned rows' content", () => {
    const pinned = run(cursorIn(tableState(rows), "Name"), pinHeaderRows).state;
    const renamed = pinned.apply(cursorIn(pinned, "Name").tr.insertText("First "));
    expect(pinnedRowsKey(renamed.doc.child(0))).not.toBe(pinnedRowsKey(pinned.doc.child(0)));
  });

  it("inserts an empty pinned title row at the top with the cursor in it", () => {
    const { state } = run(cursorIn(tableState(rows), "Bob"), insertTitleRow);
    expect(grid(state)[0]).toEqual(["", ""]);
    expect(state.doc.child(0).childCount).toBe(4);
    expect(headerRowCount(state.doc.child(0))).toBe(1);
    expect(state.selection.$from.node(-1).type.name).toBe("tableHeader");
  });
});
