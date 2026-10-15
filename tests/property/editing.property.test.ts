// Property tests of editing in one editor: undo, suggestions and document tabs. PROPERTY_RUNS and
// PROPERTY_SEED as in sync.property.test.ts.
import { applySuggestions, hasSuggestions } from "@docs/shared";
import { undo, undoDepth } from "@tiptap/pm/history";
import type { Node } from "@tiptap/pm/model";
import { EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";
import { Transform } from "@tiptap/pm/transform";
import { deleteSelection, splitBlock, toggleMark } from "@tiptap/pm/commands";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { currentTab } from "../../client/src/editor/documentTabs.ts";
import { resolveSuggestions, setSuggesting } from "../../client/src/editor/suggesting.ts";
import { buildEdit, editArbitrary, SELECT_FIRST, type Edit, type EditKind } from "./edits.ts";
import { dispatchTo, editorState, startDocument } from "./world.ts";

const runs = Number(process.env.PROPERTY_RUNS) || 100;
const seed = process.env.PROPERTY_SEED ? Number(process.env.PROPERTY_SEED) : undefined;
const settings = { numRuns: runs, ...(seed !== undefined && { seed }) };

let clock = 1_000_000;
/** Edits a second apart: the history does not group them, and each suggestion group times out. */
const tick = () => (clock += 1000);

function fresh(doc: Node = startDocument): EditorState {
  return editorState(doc, { version: 0, clientID: "me", mode: "editing", comments: [] });
}

function edit(state: EditorState, value: Edit): EditorState {
  const tr = buildEdit(state, value);
  if (!tr) return state;
  tr.setTime(tick());
  return dispatchTo(state, tr, clock);
}

function setMode(state: EditorState, suggesting: boolean): EditorState {
  return dispatchTo(state, setSuggesting(state.tr, { mode: suggesting ? "suggesting" : "editing" }), clock);
}

/** Every suggestion accepted or rejected, as Accept all / Reject all in Review suggested edits. */
function resolveAll(state: EditorState, action: "accept" | "reject"): Node {
  const tr = resolveSuggestions(state, action, null);
  const doc = tr ? dispatchTo(state, tr, tick()).doc : state.doc;
  doc.check();
  expect(hasSuggestions(doc)).toBe(false);
  return doc;
}

const everything: EditKind[] = ["type", "delete", "mark", "split", "join", "blockType", "list", "insert", "table", "image", "docAttr", "tab", "undo", "redo"];
/** What Suggesting mode turns into suggestions (merging cells, page setup and tabs are applied directly). */
const suggestible: EditKind[] = ["type", "delete", "mark", "split", "join", "blockType", "list", "insert", "image", "undo", "redo"];
const suggestibleTable = fc.record({
  kind: fc.constant("table" as const),
  at: fc.integer({ min: 0, max: 9999 }).map((value) => value / 10_000),
  op: fc.constantFrom("addRow" as const, "addColumn" as const, "deleteRow" as const, "deleteColumn" as const),
});
const suggestingEdit = fc.oneof({ weight: 10, arbitrary: editArbitrary(suggestible) }, { weight: 1, arbitrary: suggestibleTable });

describe("editing (property)", () => {
  it("undoing every change returns to the document it started from, in either mode", () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.boolean(), editArbitrary(everything.filter((kind) => kind !== "undo" && kind !== "redo"))), { maxLength: 40 }), (list) => {
        let state = fresh();
        for (const [suggesting, value] of list) {
          if (suggesting !== (state.plugins.length > 0 && isSuggesting(state))) state = setMode(state, suggesting);
          state = edit(state, value);
          state.doc.check();
        }
        for (let guard = 0; undoDepth(state) > 0 && guard < 200; guard++) {
          let next: Transaction | null = null;
          undo(state, (tr) => (next = tr));
          if (!next) break;
          state = dispatchTo(state, next, tick());
        }
        expect(state.doc.toJSON()).toEqual(startDocument.toJSON());
      }),
      settings,
    );
  });

  it("rejecting all suggestions returns to the document before Suggesting mode", () => {
    fc.assert(
      fc.property(fc.array(editArbitrary(everything), { maxLength: 10 }), fc.array(suggestingEdit, { minLength: 1, maxLength: 30 }), (before, during) => {
        let state = fresh();
        for (const value of before) state = edit(state, value);
        const original = state.doc;
        // Not from list items holding more than their paragraph (a second paragraph, a table) or lists
        // nested in a list of another kind: a suggestion records the kind, preset and depth of the
        // list a paragraph is in, not what else its item held (a known limit).
        fc.pre(!hasCompoundItems(original));
        // Reopened: undo in Suggesting mode undoes only the suggestions (earlier changes are undone as they are).
        state = setMode(fresh(original), true);
        for (const value of during) {
          const next = edit(state, value);
          next.doc.check();
          // The same limit for items the suggestions make (a table inserted into a list item).
          if (hasCompoundItems(next.doc)) break;
          state = next;
        }
        expect(joinedLists(resolveAll(state, "reject")).toJSON()).toEqual(joinedLists(original).toJSON());
      }),
      settings,
    );
  });

  it("accepting all suggestions gives the document the same edits make in Editing mode", () => {
    // Edits described on the document as it reads with every suggestion accepted, so the same edit
    // can be made on both: typing, deleting, formatting and splitting.
    const textEdit = fc.oneof(
      fc.record({ kind: fc.constant("type" as const), at: fc.nat(), text: fc.constantFrom("x", "yz ") }),
      fc.record({ kind: fc.constant("delete" as const), from: fc.nat(), to: fc.nat() }),
      fc.record({ kind: fc.constant("bold" as const), from: fc.nat(), to: fc.nat() }),
      fc.record({ kind: fc.constant("split" as const), at: fc.nat() }),
    );
    fc.assert(
      fc.property(fc.array(textEdit, { minLength: 1, maxLength: 25 }), (list) => {
        let suggesting = setMode(fresh(), true);
        let direct = fresh();
        for (const value of list) {
          const accept = applySuggestions(new Transform(suggesting.doc), "accept");
          expect(contentOf(accept.doc)).toEqual(contentOf(direct.doc));
          const positions = textPositions(direct);
          const at = (index: number) => positions[index % positions.length]!;
          // A position of the accepted document in the document with suggestions: the deleted text is
          // where accepting removes it.
          const back = accept.mapping.invert();
          const inSuggesting = (pos: number, assoc: number) => back.map(pos, assoc);
          const run = (state: EditorState, build: (state: EditorState) => Transaction | null) => {
            const tr = build(state);
            return tr ? dispatchTo(state, tr.setTime(tick()), clock) : state;
          };
          switch (value.kind) {
            case "type":
              direct = run(direct, (state) => state.tr.insertText(value.text, at(value.at)));
              suggesting = run(suggesting, (state) => state.tr.insertText(value.text, inSuggesting(at(value.at), 1)));
              break;
            case "delete":
            case "bold": {
              const [from, to] = [at(value.from), at(value.to)].sort((a, b) => a - b) as [number, number];
              if (from === to) break;
              const command = value.kind === "delete" ? deleteSelection : toggleMark(direct.schema.marks.bold!);
              const select = (state: EditorState, a: number, b: number) => state.apply(state.tr.setSelection(TextSelection.between(state.doc.resolve(a), state.doc.resolve(b))));
              const viaCommand = (state: EditorState, a: number, b: number) => {
                let result: Transaction | null = null;
                const selected = select(state, a, b);
                command(selected, (tr) => (result = tr));
                return result ? (result as Transaction).setMeta(SELECT_FIRST, selected.selection) : null;
              };
              const before = direct.doc;
              direct = run(direct, (state) => viaCommand(state, from, to));
              // Bold toggles off where all of the range is bold; the same then holds in the accepted view.
              if (value.kind === "bold" || direct.doc !== before) suggesting = run(suggesting, (state) => viaCommand(state, inSuggesting(from, 1), inSuggesting(to, -1)));
              break;
            }
            case "split":
              direct = run(direct, (state) => splitAt(state, at(value.at)));
              suggesting = run(suggesting, (state) => splitAt(state, inSuggesting(at(value.at), 1)));
              break;
          }
          suggesting.doc.check();
        }
        expect(contentOf(resolveAll(suggesting, "accept"))).toEqual(contentOf(direct.doc));
      }),
      settings,
    );
  });
});

/**
 * The text, block by block. Not the blocks' styles: when a deletion joins two paragraphs, Editing
 * mode keeps one or the other paragraph's style depending on how the selection lies (ProseMirror's
 * fitting), an accepted suggestion always the first one's. Not the formatting either: text typed
 * where formatted text was deleted takes that formatting in one and not in the other.
 */
function contentOf(doc: Node): string[] {
  const blocks: string[] = [];
  doc.descendants((node) => {
    if (!node.isTextblock) return true;
    blocks.push(node.textContent);
    return false;
  });
  return blocks;
}

/**
 * The document with lists of the same kind next to each other joined: they read as one list, and
 * a rejected "remove from list" puts the paragraph back joined with the lists around it.
 */
function joinedLists(doc: Node): Node {
  const tr = new Transform(doc);
  for (let changed = true; changed; ) {
    changed = false;
    tr.doc.descendants((node, pos) => {
      if (changed) return false;
      const $pos = tr.doc.resolve(pos);
      const before = $pos.nodeBefore;
      if (["bulletList", "orderedList", "taskList"].includes(node.type.name) && before?.type === node.type && JSON.stringify(before.attrs) === JSON.stringify(node.attrs)) {
        tr.join(pos);
        changed = true;
      }
      return !changed;
    });
  }
  return tr.doc;
}

function hasCompoundItems(doc: Node): boolean {
  let found = false;
  doc.descendants((node) => {
    const lists = ["bulletList", "orderedList", "taskList"];
    if ((node.type.name === "listItem" || node.type.name === "taskItem") && node.childCount > 1 && !lists.includes(node.child(1).type.name)) found = true;
    // A list nested in an item of a list of another kind.
    if (lists.includes(node.type.name)) node.descendants((inner) => void (lists.includes(inner.type.name) && inner.type !== node.type && (found = true)));
    return !found;
  });
  return found;
}

function isSuggesting(state: EditorState): boolean {
  return (state.plugins.find((plugin) => (plugin as unknown as { key: string }).key.startsWith("suggesting$"))?.getState(state) as { mode: string } | undefined)?.mode === "suggesting";
}

/** Positions in paragraphs (not headings, lists or tables, to keep the edits simple) of the shown tab. */
function textPositions(state: EditorState): number[] {
  const tab = currentTab(state);
  const positions: number[] = [];
  state.doc.nodesBetween(tab.from, tab.to, (node, pos) => {
    if (node.isTextblock) for (let offset = 0; offset <= node.content.size; offset++) positions.push(pos + 1 + offset);
    // Only the tab's own paragraphs: deleting into a table cell restructures the table in Editing
    // mode, which a suggestion does not (it strikes the text through).
    return node.type.name === "documentTab";
  });
  return positions;
}

function splitAt(state: EditorState, pos: number): Transaction | null {
  let result: Transaction | null = null;
  const selected = state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
  splitBlock(selected, (tr) => (result = tr));
  return result ? (result as Transaction).setMeta(SELECT_FIRST, selected.selection) : null;
}
