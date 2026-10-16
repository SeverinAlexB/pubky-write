import { documentSchema } from "@pubky-write/shared";
import { history, undo } from "@tiptap/pm/history";
import { Node } from "@tiptap/pm/model";
import { EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { resizedImage } from "./imageView.ts";
import { compareCellText, distributeColumns, distributeRows, setColumnWidths, sortTable, tableSizeAt } from "./tables.ts";

const cell = (value: string, type = "tableCell", attrs?: Record<string, unknown>) => ({
  type,
  ...(attrs && { attrs }),
  content: [{ type: "paragraph", content: value ? [{ type: "text", text: value }] : [] }],
});
const row = (...cells: unknown[]) => ({ type: "tableRow", content: cells });

function tableState(rows: unknown[]): EditorState {
  const doc = Node.fromJSON(documentSchema, { type: "doc", content: [{ type: "table", content: rows }, { type: "paragraph" }] });
  return EditorState.create({ doc, plugins: [history()] });
}

/** Puts the cursor at the start of the text of the cell with `text`. */
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

const rowTexts = (state: EditorState) => {
  const texts: string[][] = [];
  state.doc.child(0).forEach((tableRow) => {
    const cells: string[] = [];
    tableRow.forEach((tableCell) => cells.push(tableCell.textContent));
    texts.push(cells);
  });
  return texts;
};

const fruit = [row(cell("Banana"), cell("3")), row(cell("apple"), cell("10")), row(cell(""), cell("1")), row(cell("Cherry"), cell("2"))];

describe("sortTable", () => {
  it("sorts the rows by the cursor's column, empty cells last", () => {
    const { state } = run(cursorIn(tableState(fruit), "Banana"), sortTable("ascending"));
    expect(rowTexts(state)).toEqual([["apple", "10"], ["Banana", "3"], ["Cherry", "2"], ["", "1"]]);

    const descending = run(cursorIn(tableState(fruit), "3"), sortTable("descending")).state;
    expect(rowTexts(descending)).toEqual([["apple", "10"], ["Banana", "3"], ["Cherry", "2"], ["", "1"]]);
    // Numbers sort by value, not as text.
    const ascending = run(cursorIn(tableState(fruit), "3"), sortTable("ascending")).state;
    expect(rowTexts(ascending).map(([, number]) => number)).toEqual(["1", "2", "3", "10"]);
  });

  it("keeps the cursor in its cell and is one undo step", () => {
    const { state } = run(cursorIn(tableState(fruit), "Banana"), sortTable("ascending"));
    expect(state.selection.$head.parent.textContent).toBe("Banana");
    const undone = run(state, undo).state;
    expect(rowTexts(undone)).toEqual(rowTexts(tableState(fruit)));
  });

  it("is not merged into the typing just before it", () => {
    const state = cursorIn(tableState(fruit), "Banana");
    const typed = state.apply(state.tr.insertText("Z"));
    const sorted = run(typed, sortTable("ascending")).state;
    const undone = run(sorted, undo).state;
    expect(rowTexts(undone).map(([name]) => name)).toEqual(["ZBanana", "apple", "", "Cherry"]);
  });

  it("keeps header rows at the top", () => {
    const withHeader = [row(cell("Fruit", "tableHeader"), cell("Count", "tableHeader")), ...fruit];
    const { state } = run(cursorIn(tableState(withHeader), "Banana"), sortTable("descending"));
    expect(rowTexts(state).map(([name]) => name)).toEqual(["Fruit", "Cherry", "Banana", "apple", ""]);
  });

  it("cannot sort rows with cells merged across rows, or outside a table", () => {
    const merged = [row(cell("b", "tableCell", { rowspan: 2 }), cell("1")), row(cell("2")), row(cell("a"), cell("3"))];
    expect(run(cursorIn(tableState(merged), "a"), sortTable("ascending")).applied).toBe(false);
    const outside = tableState(fruit);
    const atEnd = outside.apply(outside.tr.setSelection(TextSelection.atEnd(outside.doc)));
    expect(run(atEnd, sortTable("ascending")).applied).toBe(false);
  });
});

describe("compareCellText", () => {
  it("ignores case and puts empty cells last in both directions", () => {
    expect(compareCellText("apple", "Banana", "ascending")).toBeLessThan(0);
    expect(compareCellText("apple", "Banana", "descending")).toBeGreaterThan(0);
    expect(compareCellText("", "a", "ascending")).toBeGreaterThan(0);
    expect(compareCellText("", "a", "descending")).toBeGreaterThan(0);
  });
});

describe("column widths and distributing", () => {
  const widths = (state: EditorState) => {
    const result: unknown[] = [];
    state.doc.child(0).child(0).forEach((tableCell) => result.push(tableCell.attrs.colwidth));
    return result;
  };

  it("stores every column's width, across merged cells", () => {
    const state = tableState([row(cell("a", "tableCell", { colspan: 2 }), cell("c")), row(cell("d"), cell("e"), cell("f"))]);
    const next = state.apply(setColumnWidths(state.tr, 0, [100, 200, 300]));
    expect(widths(next)).toEqual([[100, 200], [300]]);
    const secondRow: unknown[] = [];
    next.doc.child(0).child(1).forEach((tableCell) => secondRow.push(tableCell.attrs.colwidth));
    expect(secondRow).toEqual([[100], [200], [300]]);
  });

  it("distribute columns makes them equal, in one undo step", () => {
    const state = cursorIn(tableState(fruit), "Banana");
    const resized = state.apply(setColumnWidths(state.tr, 0, [400, 200]));
    const { state: distributed } = run(resized, distributeColumns);
    expect(widths(distributed)).toEqual([null, null]);
    expect(widths(run(distributed, undo).state)).toEqual([[400], [200]]);
  });

  it("distribute rows gives every row the tallest row's height", () => {
    const state = cursorIn(tableState(fruit), "Banana");
    const { state: distributed } = run(state, distributeRows([30, 52.4, 30, 31]));
    const heights: unknown[] = [];
    distributed.doc.child(0).forEach((tableRow) => heights.push(tableRow.attrs.height));
    expect(heights).toEqual([52, 52, 52, 52]);
    expect(run(state, distributeRows([30])).applied).toBe(false);
  });

  it("reports the table's size", () => {
    expect(tableSizeAt(cursorIn(tableState(fruit), "Banana"))).toEqual({ columns: 2, rows: 4 });
  });
});

describe("resizedImage", () => {
  const start = { width: 300, height: 150 };

  it("keeps the proportions from a corner", () => {
    expect(resizedImage(start, "se", 150, 10, false, 1000)).toEqual({ width: 450, height: 225 });
    expect(resizedImage(start, "nw", 60, 0, false, 1000)).toEqual({ width: 240, height: 120 });
  });

  it("stretches one side from an edge, or keeps the proportions with Shift", () => {
    expect(resizedImage(start, "e", 100, 40, false, 1000)).toEqual({ width: 400, height: 150 });
    expect(resizedImage(start, "s", 100, 50, false, 1000)).toEqual({ width: 300, height: 200 });
    expect(resizedImage(start, "w", -100, 0, false, 1000)).toEqual({ width: 400, height: 150 });
    expect(resizedImage(start, "e", 100, 0, true, 1000)).toEqual({ width: 400, height: 200 });
  });

  it("stays within the page and above the minimum size", () => {
    expect(resizedImage(start, "se", 1000, 0, false, 600)).toEqual({ width: 600, height: 300 });
    expect(resizedImage(start, "e", -1000, 0, false, 600)).toEqual({ width: 8, height: 150 });
  });
});
