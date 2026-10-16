// Random edits for the property tests: each is a plain description (numbers for positions, so
// fast-check can generate and shrink them) that `buildEdit` turns into a transaction on the state
// it is applied to, like a user's command would. Positions are fractions of the valid positions in
// the shown tab, so the same description works on any document.
import { documentSchema, documentTabs, firstTab, type RegionContent } from "@pubky-write/shared";
import { deleteSelection, joinBackward, lift, setBlockType, splitBlock, toggleMark } from "@tiptap/pm/commands";
import { redo, undo } from "../../client/src/editor/tabHistory.ts";
import type { Node } from "@tiptap/pm/model";
import { liftListItem, splitListItem, wrapInList } from "@tiptap/pm/schema-list";
import { EditorState, NodeSelection, TextSelection, type Command, type Selection, type Transaction } from "@tiptap/pm/state";
import { addColumnAfter, addRowAfter, deleteColumn, deleteRow, mergeCells, CellSelection } from "@tiptap/pm/tables";
import fc from "fast-check";
import { currentTab } from "../../client/src/editor/documentTabs.ts";
import {
  addSubtab,
  addTab,
  deleteTab,
  duplicateTab,
  moveTab,
  moveTabInto,
  setTabAttribute,
  switchTab,
} from "../../client/src/editor/documentTabs.ts";

const schema = documentSchema;

export type Edit =
  | { kind: "type"; at: number; text: string }
  | { kind: "delete"; from: number; to: number }
  | { kind: "mark"; from: number; to: number; mark: "bold" | "italic" | "color" | "link" }
  | { kind: "split"; at: number }
  | { kind: "join"; at: number }
  | { kind: "blockType"; at: number; level: number }
  | { kind: "list"; at: number; list: "bulletList" | "orderedList" | "lift" }
  | { kind: "insert"; at: number; object: "table" | "image" | "pageBreak" | "footnote" | "horizontalRule" }
  | { kind: "table"; at: number; op: "addRow" | "addColumn" | "deleteRow" | "deleteColumn" | "merge" }
  | { kind: "image"; at: number; width: number }
  | { kind: "docAttr"; attr: "columns" | "orientation" | "marginLeft" | "header"; value: number }
  | { kind: "tab"; op: "add" | "addSubtab" | "delete" | "duplicate" | "moveUp" | "moveDown" | "moveInto" | "rename" | "switch"; index: number }
  | { kind: "undo" }
  | { kind: "redo" };

export type EditKind = Edit["kind"];

const fraction = fc.integer({ min: 0, max: 9999 }).map((value) => value / 10_000);

/** Edits of the given kinds; typed text is `word` (unique tokens are added by the caller when needed). */
export function editArbitrary(kinds: readonly EditKind[], word: fc.Arbitrary<string> = fc.constantFrom("a", "bc", "def ", " x")): fc.Arbitrary<Edit> {
  const all: Record<EditKind, fc.Arbitrary<Edit>> = {
    type: fc.record({ kind: fc.constant("type" as const), at: fraction, text: word }),
    delete: fc.record({ kind: fc.constant("delete" as const), from: fraction, to: fraction }),
    mark: fc.record({ kind: fc.constant("mark" as const), from: fraction, to: fraction, mark: fc.constantFrom("bold" as const, "italic" as const, "color" as const, "link" as const) }),
    split: fc.record({ kind: fc.constant("split" as const), at: fraction }),
    join: fc.record({ kind: fc.constant("join" as const), at: fraction }),
    blockType: fc.record({ kind: fc.constant("blockType" as const), at: fraction, level: fc.integer({ min: 0, max: 3 }) }),
    list: fc.record({ kind: fc.constant("list" as const), at: fraction, list: fc.constantFrom("bulletList" as const, "orderedList" as const, "lift" as const) }),
    insert: fc.record({
      kind: fc.constant("insert" as const),
      at: fraction,
      object: fc.constantFrom("table" as const, "image" as const, "pageBreak" as const, "footnote" as const, "horizontalRule" as const),
    }),
    table: fc.record({
      kind: fc.constant("table" as const),
      at: fraction,
      op: fc.constantFrom("addRow" as const, "addColumn" as const, "deleteRow" as const, "deleteColumn" as const, "merge" as const),
    }),
    image: fc.record({ kind: fc.constant("image" as const), at: fraction, width: fc.integer({ min: 20, max: 400 }) }),
    docAttr: fc.record({
      kind: fc.constant("docAttr" as const),
      attr: fc.constantFrom("columns" as const, "orientation" as const, "marginLeft" as const, "header" as const),
      value: fc.integer({ min: 0, max: 2 }),
    }),
    tab: fc.record({
      kind: fc.constant("tab" as const),
      op: fc.constantFrom(
        "add" as const,
        "addSubtab" as const,
        "delete" as const,
        "duplicate" as const,
        "moveUp" as const,
        "moveDown" as const,
        "moveInto" as const,
        "rename" as const,
        "switch" as const,
      ),
      index: fc.nat({ max: 5 }),
    }),
    undo: fc.constant({ kind: "undo" as const }),
    redo: fc.constant({ kind: "redo" as const }),
  };
  return fc.oneof(...kinds.map((kind) => all[kind]));
}

/** Positions in the shown tab where text can go. */
function textPositions(state: EditorState): number[] {
  const tab = currentTab(state);
  const positions: number[] = [];
  state.doc.nodesBetween(tab.from, tab.to, (node, pos) => {
    if (!node.isTextblock) return true;
    for (let offset = 0; offset <= node.content.size; offset++) positions.push(pos + 1 + offset);
    return false;
  });
  return positions;
}

/** Start positions of the textblocks in the shown tab. */
function blockStarts(state: EditorState): number[] {
  const tab = currentTab(state);
  const starts: number[] = [];
  state.doc.nodesBetween(tab.from, tab.to, (node, pos) => {
    if (!node.isTextblock) return true;
    starts.push(pos + 1);
    return false;
  });
  return starts;
}

const pick = <T>(list: readonly T[], at: number): T | undefined => list[Math.min(list.length - 1, Math.floor(at * list.length))];

/** Runs a ProseMirror command on `state` with `selection`; the transaction it made, or null. */
function command(state: EditorState, selection: Selection | null, run: Command): Transaction | null {
  const start = selection ? state.apply(state.tr.setSelection(selection)) : state;
  let result: Transaction | null = null;
  // The transaction starts from the same document, so it applies to `state` too. The selection is
  // made first, as a user selects and then edits (dispatchTo applies it on its own).
  run(start, (tr) => (result = tr));
  return result && selection ? (result as Transaction).setMeta(SELECT_FIRST, selection) : result;
}

/** Meta of a transaction made with a selection: dispatchTo makes the selection first. */
export const SELECT_FIRST = "propertySelectFirst";

/** A short JSON header, for page setup edits. */
const header = (text: string): RegionContent => [{ type: "paragraph", content: [{ type: "text", text }] }] as RegionContent;

/**
 * The transaction for `edit` on `state`, or null when it is not possible there (a table operation
 * outside a table, undo with nothing to undo). Throws only for bugs.
 */
export function buildEdit(state: EditorState, edit: Edit): Transaction | null {
  const positions = textPositions(state);
  // A tab can hold no text at all (only an image or a table of contents): nothing to edit there.
  if (positions.length === 0 && !["docAttr", "tab", "undo", "redo"].includes(edit.kind)) return null;
  const at = (value: number) => pick(positions, value)!;
  switch (edit.kind) {
    case "type": {
      const pos = at(edit.at);
      return state.tr.setSelection(TextSelection.create(state.doc, pos)).insertText(edit.text);
    }
    case "delete": {
      const [from, to] = [at(edit.from), at(edit.to)].sort((a, b) => a - b) as [number, number];
      if (from === to) return null;
      return command(state, TextSelection.between(state.doc.resolve(from), state.doc.resolve(to)), deleteSelection);
    }
    case "mark": {
      const [from, to] = [at(edit.from), at(edit.to)].sort((a, b) => a - b) as [number, number];
      if (from === to) return null;
      const type = edit.mark === "color" ? schema.marks.textStyle! : edit.mark === "link" ? schema.marks.link! : schema.marks[edit.mark]!;
      const attrs = edit.mark === "color" ? { color: "#ff0000" } : edit.mark === "link" ? { href: "https://example.com" } : null;
      return command(state, TextSelection.between(state.doc.resolve(from), state.doc.resolve(to)), toggleMark(type, attrs));
    }
    case "split": {
      const selection = TextSelection.create(state.doc, at(edit.at));
      const inItem = selection.$from.node(-1)?.type.name === "listItem";
      return command(state, selection, inItem ? splitListItem(schema.nodes.listItem!) : splitBlock);
    }
    case "join": {
      const start = pick(blockStarts(state), edit.at);
      if (start === undefined) return null;
      return command(state, TextSelection.create(state.doc, start), joinBackward);
    }
    case "blockType": {
      const selection = TextSelection.create(state.doc, at(edit.at));
      return command(state, selection, edit.level === 0 ? setBlockType(schema.nodes.paragraph!) : setBlockType(schema.nodes.heading!, { level: edit.level }));
    }
    case "list": {
      const selection = TextSelection.create(state.doc, at(edit.at));
      if (edit.list === "lift") return command(state, selection, (s, d) => liftListItem(schema.nodes.listItem!)(s, d) || lift(s, d));
      return command(state, selection, wrapInList(schema.nodes[edit.list]!));
    }
    case "insert": {
      const pos = at(edit.at);
      const tr = state.tr.setSelection(TextSelection.create(state.doc, pos));
      const paragraph = (text = "") => schema.nodes.paragraph!.create(null, text ? schema.text(text) : null);
      switch (edit.object) {
        case "table": {
          const cell = () => schema.nodes.tableCell!.create(null, paragraph());
          const row = () => schema.nodes.tableRow!.create(null, [cell(), cell()]);
          return tr.replaceSelectionWith(schema.nodes.table!.create(null, [row(), row()]));
        }
        case "image":
          return tr.replaceSelectionWith(schema.nodes.image!.create({ src: "/uploads/picture.png" }));
        case "pageBreak":
          return tr.replaceSelectionWith(schema.nodes.pageBreak!.create());
        case "horizontalRule":
          return tr.replaceSelectionWith(schema.nodes.horizontalRule!.create());
        case "footnote": {
          if (!tr.selection.$from.parent.type.allowsMarkType || !tr.selection.$from.parent.canReplaceWith(tr.selection.$from.index(), tr.selection.$from.index(), schema.nodes.footnote!)) {
            return null;
          }
          return tr.replaceSelectionWith(schema.nodes.footnote!.create({ content: [{ type: "paragraph", content: [{ type: "text", text: "note" }] }] }));
        }
      }
      return null;
    }
    case "table": {
      const $pos = state.doc.resolve(at(edit.at));
      let cellDepth = -1;
      for (let depth = $pos.depth; depth > 0; depth--) {
        if ($pos.node(depth).type.spec.tableRole === "cell" || $pos.node(depth).type.spec.tableRole === "header_cell") {
          cellDepth = depth;
          break;
        }
      }
      if (cellDepth < 0) return null;
      const selection = TextSelection.create(state.doc, $pos.pos);
      if (edit.op === "merge") {
        // The cell and the one after it in the row, if any.
        const cellPos = $pos.before(cellDepth);
        const next = cellPos + $pos.node(cellDepth).nodeSize;
        if (state.doc.resolve(next).nodeAfter?.type.spec.tableRole !== "cell") return null;
        return command(state, CellSelection.create(state.doc, cellPos, next), mergeCells);
      }
      const commands = { addRow: addRowAfter, addColumn: addColumnAfter, deleteRow, deleteColumn };
      return command(state, selection, commands[edit.op]);
    }
    case "image": {
      let found: { node: Node; pos: number } | null = null;
      const images: { node: Node; pos: number }[] = [];
      const tab = currentTab(state);
      state.doc.nodesBetween(tab.from, tab.to, (node, pos) => {
        if (node.type.name === "image") images.push({ node, pos });
      });
      found = pick(images, (edit.width % 7) / 7) ?? null;
      if (!found) return null;
      return state.tr.setSelection(NodeSelection.create(state.doc, found.pos)).setNodeMarkup(found.pos, null, { ...found.node.attrs, width: edit.width, height: edit.width });
    }
    case "docAttr": {
      const tr = state.tr;
      if (edit.attr === "columns") return tr.setDocAttribute("columns", edit.value + 1);
      if (edit.attr === "orientation") return tr.setDocAttribute("orientation", edit.value === 1 ? "landscape" : "portrait");
      if (edit.attr === "marginLeft") return tr.setDocAttribute("marginLeft", 36 + edit.value * 18);
      return tr.setDocAttribute("header", edit.value === 0 ? null : header(`Header ${edit.value}`));
    }
    case "tab": {
      const tabs = documentTabs(state.doc);
      const tab = tabs[edit.index % tabs.length] ?? firstTab(state.doc);
      switch (edit.op) {
        case "add":
          return addTab(state, tab.id);
        case "addSubtab":
          return addSubtab(state, tab.id);
        case "delete":
          return deleteTab(state, tab.id);
        case "duplicate":
          return duplicateTab(state, tab.id);
        case "moveUp":
          return moveTab(state, tab.id, -1);
        case "moveDown":
          return moveTab(state, tab.id, 1);
        case "moveInto": {
          const other = tabs[(edit.index + 1) % tabs.length];
          return other && other.id !== tab.id ? moveTabInto(state, tab.id, other.id) : null;
        }
        case "rename":
          return setTabAttribute(state, tab.id, "name", `Name ${edit.index}`);
        case "switch":
          return switchTab(state, tab.id);
      }
      return null;
    }
    case "undo":
      return command(state, null, undo);
    case "redo":
      return command(state, null, redo);
  }
}

/** The tokens of `text` in a document's text, headers and footnotes excluded. */
export function countOf(doc: Node, token: string): number {
  return doc.textBetween(0, doc.content.size, "\n", "\n").split(token).length - 1;
}
