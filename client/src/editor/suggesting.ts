// Suggesting mode: rewrites edits into suggestions before they are applied, keeps the list of
// suggestions for the cards, highlights the active one and accepts or rejects them.
// See docs/design/suggesting.md.
import {
  applySuggestions,
  blockFormat,
  collectSuggestions,
  formatMarks,
  isSuggestedObject,
  joinable,
  newSuggestionId,
  objectSuggestion,
  regionHasSuggestions,
  regionKeys,
  sameJSON,
  stripSuggestions,
  SUGGESTION_AUTHOR,
  type BreakSuggestion,
  type FormatSuggestion,
  type ImageFormatSuggestion,
  type MarkJSON,
  type Suggestion,
  type SuggestionMeta,
} from "@docs/shared";
import { Extension, type Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { ChangeSet, type Change, type TokenEncoder } from "@tiptap/pm/changeset";
import type { Mark, MarkType, Node, Schema, Slice } from "@tiptap/pm/model";
import { EditorState, NodeSelection, Plugin, PluginKey, Selection, TextSelection, type Transaction } from "@tiptap/pm/state";
import {
  AddMarkStep,
  AttrStep,
  DocAttrStep,
  Mapping,
  RemoveMarkStep,
  ReplaceAroundStep,
  ReplaceStep,
  type Step,
  type StepMap,
} from "@tiptap/pm/transform";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export type EditorMode = "editing" | "suggesting" | "viewing";
/** What the pages show: suggestions with their styling, or a preview of accepting or rejecting all. */
export type SuggestionView = "suggestions" | "accepted" | "rejected";

/** A new suggestion starts after this long without an edit. */
export const GROUP_TIMEOUT_MS = 2 * 60 * 1000;

/** Marks accept and reject transactions, which the rewriting and the read-only guard let through. */
export const SUGGESTION_COMMAND = "suggestionCommand";
/** Set on transactions the rewriting produced. */
const REWRITTEN = "suggestionRewritten";
/** -1 or 1 on deletions whose direction is known (Backspace or Delete), for placing the cursor. */
const DELETE_DIRECTION = "suggestionDeleteDirection";
/** Set on edits that are applied as they are even in Suggesting mode (merging and splitting cells, sorting a table). */
export const SUGGESTION_DIRECT = "suggestionDirect";

/** Marks a transaction to be applied directly, not as a suggestion. */
export function applyDirectly(tr: Transaction): Transaction {
  return tr.setMeta(SUGGESTION_DIRECT, true);
}

type Group = { id: string; createdAt: number; time: number };

export type SuggestingState = {
  mode: EditorMode;
  /** Viewing mode and the previews: transactions that change the document are dropped. */
  readOnly: boolean;
  /** The suggestion that consecutive edits at the same place extend. */
  group: Group | null;
  suggestions: Suggestion[];
  activeId: string | null;
  /**
   * The active suggestion is the one being made (activated by an edit, not a click): it stays
   * active while the cursor is in or next to it.
   */
  activeFollowsCursor: boolean;
};

type SuggestingMeta = Partial<Pick<SuggestingState, "mode" | "readOnly" | "group" | "activeId" | "activeFollowsCursor">>;

export const suggestingKey = new PluginKey<SuggestingState>("suggesting");

const emptyState: SuggestingState = {
  mode: "editing",
  readOnly: false,
  group: null,
  suggestions: [],
  activeId: null,
  activeFollowsCursor: false,
};

export function getSuggesting(state: EditorState): SuggestingState {
  return suggestingKey.getState(state) ?? emptyState;
}

export function setSuggesting(tr: Transaction, meta: SuggestingMeta): Transaction {
  return tr.setMeta(suggestingKey, { ...(tr.getMeta(suggestingKey) as SuggestingMeta | undefined), ...meta });
}

type SuggestionTypes = { insert: MarkType; delete: MarkType; format: MarkType };

function suggestionTypes(schema: Schema): SuggestionTypes {
  return { insert: schema.marks.suggestionInsert!, delete: schema.marks.suggestionDelete!, format: schema.marks.suggestionFormat! };
}

export type SuggestContext = { author: string; now: number; group: Group | null };
/** `made`: the suggestion the edit made or extended, which becomes the active one. */
export type SuggestResult = { tr: Transaction; group: Group | null; made: string | null };

/** Whether a transaction is applied as it is in Suggesting mode. */
function passesThrough(tr: Transaction): boolean {
  return (
    !tr.docChanged ||
    tr.getMeta("history$") !== undefined ||
    tr.getMeta("addToHistory") === false ||
    tr.getMeta(SUGGESTION_COMMAND) === true ||
    tr.getMeta(REWRITTEN) === true ||
    tr.getMeta(SUGGESTION_DIRECT) === true ||
    tr.steps.every((step) => step instanceof DocAttrStep)
  );
}

/**
 * The transaction as suggestions, built from `state`, or null when it should be applied as it is
 * (it does not change the document, or changes structure that suggestions cannot express).
 */
export function suggestTransaction(state: EditorState, tr: Transaction, context: SuggestContext): SuggestResult | null {
  if (passesThrough(tr) || tr.before !== state.doc) return null;
  // Changing an image's attributes replaces the leaf node with a changed copy: a format change.
  // Deleting a selection that ends in a list or table cell can be one step that keeps the text in
  // between (a ReplaceAroundStep) but removes text around it: a content change, not a wrap.
  const replaces = tr.steps.some(
    (step, index) =>
      (step instanceof ReplaceStep && !isLeafMarkupChange(tr.docs[index]!, step)) ||
      (step instanceof ReplaceAroundStep && removesInline(tr.docs[index]!, step)),
  );
  const wraps = tr.steps.some((step, index) => step instanceof ReplaceAroundStep && !removesInline(tr.docs[index]!, step));
  // Dragging a placed image to another paragraph moves it; that is applied as it is.
  if (replaces && isImageMove(state.doc, tr)) return null;
  const result = !replaces
    ? rewriteFormat(state, tr, context)
    : (deleteSelectionSuggestion(state, tr, context) ??
      (!wraps ? rewriteContent(state, tr, context) : textblockWrapsOnly(tr) ? rewriteInRuns(state, tr, context) : null) ??
      joinSuggestion(state, tr, context));
  if (!result) return null;
  copyTransactionState(tr, result.tr);
  result.tr.setMeta(REWRITTEN, true);
  setSuggesting(result.tr, result.made ? { group: result.group, activeId: result.made, activeFollowsCursor: true } : { group: result.group });
  return result;
}

const isContentStep = (doc: Node, step: Step) =>
  (step instanceof ReplaceStep && !isLeafMarkupChange(doc, step)) || (step instanceof ReplaceAroundStep && removesInline(doc, step));

const formatBlockTypes = new Set(["paragraph", "heading", "bulletList", "orderedList", "taskList", "listItem", "taskItem", "blockquote"]);

/** Whether the transaction's wrapping steps only change textblocks and lists (not a table's structure). */
function textblockWrapsOnly(tr: Transaction): boolean {
  return tr.steps.every((step, index) => {
    if (!(step instanceof ReplaceAroundStep) || isContentStep(tr.docs[index]!, step)) return true;
    let ok = true;
    step.slice.content.descendants((node) => {
      if (!formatBlockTypes.has(node.type.name)) ok = false;
      return ok;
    });
    return ok;
  });
}

/**
 * A transaction that both changes content and wraps or retypes textblocks (Enter at the start of a
 * heading splits it and makes the new empty block a paragraph): each run of content steps and of
 * format steps is rewritten on its own, on the result of the runs before, like suggestParts.
 */
function rewriteInRuns(state: EditorState, tr: Transaction, context: SuggestContext): SuggestResult | null {
  const runs: { content: boolean; steps: Step[] }[] = [];
  tr.steps.forEach((step, index) => {
    const content = isContentStep(tr.docs[index]!, step);
    const last = runs[runs.length - 1];
    if (last && last.content === content) last.steps.push(step);
    else runs.push({ content, steps: [step] });
  });
  const out = state.tr;
  const original: StepMap[] = [];
  let current = state;
  let group = context.group;
  let made: string | null = null;
  for (const run of runs) {
    // From the document after the original runs so far to the one after their rewritten versions.
    const remap = new Mapping([...[...original].reverse().map((map) => map.invert()), ...out.mapping.maps]);
    const part = current.tr;
    // The rewritten runs usually keep the positions (an inserted paragraph break stays where it was):
    // the step applies as it is; otherwise it is mapped over the difference.
    const unchanged = sameMaps(original, out.mapping.maps);
    for (const step of run.steps) {
      const mapped = unchanged ? step : step.map(remap);
      if (!mapped || part.maybeStep(mapped).failed) return null;
      original.push(step.getMap());
    }
    const result = run.content ? rewriteContent(current, part, { ...context, group }) : rewriteFormat(current, part, { ...context, group });
    if (!result) return null;
    for (const step of result.tr.steps) out.step(step);
    group = result.group;
    made = result.made ?? made;
    // Only the document and the selection are read by the rewriting.
    current = EditorState.create({ doc: result.tr.doc, selection: result.tr.selection });
  }
  out.setSelection(Selection.fromJSON(out.doc, current.selection.toJSON()));
  return { tr: out, group, made };
}

/**
 * Backspace at the start of a paragraph that ProseMirror joins into the one before by moving it
 * out of its structure (into an empty list item): the paragraph break is suggested for deletion.
 */
function joinSuggestion(state: EditorState, tr: Transaction, context: SuggestContext): SuggestResult | null {
  const { $from, empty } = state.selection;
  if (!empty || !$from.parent.isTextblock || $from.parentOffset !== 0 || !("suggestionBreak" in $from.parent.attrs)) return null;
  if (textblockCount(tr.doc) !== textblockCount(state.doc) - 1 || tr.doc.textContent !== state.doc.textContent) return null;
  const pos = $from.before();
  if (!canJoinBackward(state.doc, pos) || $from.parent.attrs.suggestionBreak) return null;
  const types = suggestionTypes(state.schema);
  const meta = chooseSuggestion(state.doc, pos, $from.pos, context.group, context, types);
  const out = state.tr.setNodeAttribute(pos, "suggestionBreak", { kind: "delete", ...meta });
  return { tr: out, group: { id: meta.id, createdAt: meta.createdAt, time: context.now }, made: meta.id };
}

/**
 * Deleting a selection: the selected text, the objects wholly in it and the paragraph breaks in it
 * are suggested for deletion, and nothing else changes. ProseMirror's own deletion also fits the
 * structure around it (it ends a list early or reshapes a table where the selection ends), which
 * a suggestion must not do: rejecting it would leave that. Null for anything but a deletion of the
 * selection.
 */
function deleteSelectionSuggestion(state: EditorState, tr: Transaction, context: SuggestContext): SuggestResult | null {
  const { selection } = state;
  if (selection.empty || !(selection instanceof TextSelection)) return null;
  // Nothing but deletions: no step brings in content of its own (what a ReplaceAroundStep keeps is its gap).
  const insertsContent = tr.steps.some((step) => {
    if (!(step instanceof ReplaceStep || step instanceof ReplaceAroundStep)) return true;
    let inline = false;
    step.slice.content.descendants((node) => {
      if (node.isInline || node.isAtom) inline = true;
      return !inline;
    });
    return inline;
  });
  if (insertsContent || tr.doc.content.size >= state.doc.content.size) return null;
  const types = suggestionTypes(state.schema);
  const out = state.tr;
  const meta = chooseSuggestion(out.doc, selection.from, selection.to, context.group, context, types);
  markDeleted(out, selection.from, selection.to, meta, context.author, types);
  // The cursor goes after the struck-through text, as for other deletions.
  out.setSelection(Selection.near(out.doc.resolve(out.mapping.map(selection.to, 1)), -1));
  return { tr: out, group: { id: meta.id, createdAt: meta.createdAt, time: context.now }, made: meta.id };
}

/** Whether two lists of step maps change the same ranges. */
function sameMaps(a: readonly StepMap[], b: readonly StepMap[]): boolean {
  const ranges = (maps: readonly StepMap[]) => {
    const result: number[] = [];
    for (const map of maps) map.forEach((oldStart, oldEnd, newStart, newEnd) => result.push(oldStart, oldEnd, newStart, newEnd));
    return result.join(",");
  };
  return ranges(a) === ranges(b);
}

/**
 * Whether a ReplaceAroundStep removes content rather than only wrapping, lifting or retyping it:
 * inline content (text, images) around its gap, or a paragraph boundary (Backspace joining a
 * paragraph into an empty list item).
 */
function removesInline(doc: Node, step: ReplaceAroundStep): boolean {
  const after = step.apply(doc).doc;
  if (after && textblockCount(after) < textblockCount(doc)) return true;
  let found = false;
  for (const [from, to] of [
    [step.from, step.gapFrom],
    [step.gapTo, step.to],
  ] as const) {
    if (to > from) {
      doc.nodesBetween(from, to, (node, pos) => {
        if (node.isInline && pos < to && pos + node.nodeSize > from) found = true;
        return !found;
      });
    }
  }
  return found;
}

const textblockCounts = new WeakMap<Node, number>();

function textblockCount(doc: Node): number {
  let count = textblockCounts.get(doc);
  if (count !== undefined) return count;
  count = 0;
  doc.descendants((node) => {
    if (node.isTextblock) count!++;
    return !node.isTextblock;
  });
  textblockCounts.set(doc, count);
  return count;
}

/** A step that replaces a leaf object (an image) by one of the same type: only its attributes change. */
function isLeafMarkupChange(doc: Node, step: ReplaceStep): boolean {
  const { slice } = step;
  if (slice.openStart !== 0 || slice.openEnd !== 0 || slice.content.childCount !== 1) return false;
  const before = doc.nodeAt(step.from);
  const after = slice.content.firstChild!;
  return !!before && before.isLeaf && isSuggestedObject(before) && step.to - step.from === before.nodeSize && after.type === before.type;
}

/** One part of a composite edit. `map` maps positions of the state the edit started from to `tr`'s document. */
export type Part = (tr: Transaction, map: (pos: number, assoc?: number) => number) => void;

/**
 * One transaction made of `parts`, each applied to the result of the ones before. In Suggesting
 * mode each part is rewritten into suggestions on its own: a single transaction that both deletes
 * text and formats text (as Markdown shortcuts do) would lose its formatting in the rewrite. The
 * result passes the dispatch hook as it is. Null when nothing changes.
 */
export function suggestParts(state: EditorState, parts: Part[], now = Date.now()): Transaction | null {
  const suggesting = getSuggesting(state);
  const out = state.tr;
  const map = (pos: number, assoc = 1) => out.mapping.map(pos, assoc);
  if (suggesting.mode !== "suggesting") {
    for (const part of parts) part(out, map);
    return out.docChanged ? out : null;
  }
  let current = state;
  let group = suggesting.group;
  let made: string | null = null;
  for (const part of parts) {
    const tr = current.tr;
    part(tr, map);
    if (!tr.docChanged) continue;
    const result = suggestTransaction(current, tr, { author: SUGGESTION_AUTHOR, now, group });
    const applied = result?.tr ?? tr;
    for (const step of applied.steps) out.step(step);
    if (result) {
      group = result.group;
      made = result.made ?? made;
    }
    // Only the document and the selection are read by the rewriting.
    current = EditorState.create({ doc: applied.doc, selection: applied.selection });
  }
  if (!out.docChanged) return null;
  out.setSelection(Selection.fromJSON(out.doc, current.selection.toJSON()));
  out.setMeta(REWRITTEN, true);
  return setSuggesting(out, made ? { group, activeId: made, activeFollowsCursor: true } : { group });
}

function copyTransactionState(from: Transaction, to: Transaction): void {
  const meta = (from as unknown as { meta: Record<string, unknown> }).meta;
  for (const key of Object.keys(meta)) to.setMeta(key, meta[key]);
  to.setTime(from.time);
  if (from.storedMarksSet) to.setStoredMarks(from.storedMarks?.filter((mark) => !isSuggestionType(mark.type)) ?? null);
  if (from.scrolledIntoView) to.scrollIntoView();
}

function isSuggestionType(type: MarkType): boolean {
  return type.name === "suggestionInsert" || type.name === "suggestionDelete" || type.name === "suggestionFormat";
}

const listTypes = new Set(["bulletList", "orderedList", "taskList", "listItem", "taskItem"]);

/**
 * Whether `from`–`to` holds only what suggestions can express: inline content (in textblocks
 * that allow suggestion marks), list structure and whole objects (images, tables, table rows and
 * cells, breaks, horizontal lines, tables of contents).
 */
function suggestableRange(doc: Node, from: number, to: number, insert: MarkType): boolean {
  if (to <= from) return true;
  let ok = true;
  doc.nodesBetween(from, to, (node, pos) => {
    if (!ok || node.isInline) return false;
    const end = pos + node.nodeSize;
    if (isSuggestedObject(node) && pos >= from && end <= to) return false;
    if (node.isTextblock) {
      if (!node.type.allowsMarkType(insert) || !("suggestionBreak" in node.attrs)) ok = false;
      return false;
    }
    // Ancestors around the whole range, and list structure.
    if ((pos < from && end > to) || listTypes.has(node.type.name)) return true;
    ok = false;
    return false;
  });
  return ok;
}

/** Whether `from`–`to` holds only the opening or closing tokens of lists, list items and quotes. */
function wrapperTokensOnly(doc: Node, from: number, to: number): boolean {
  let ok = true;
  doc.nodesBetween(from, to, (node, pos) => {
    if (!ok) return false;
    const end = pos + node.nodeSize;
    if (pos < from && end > to) return true;
    if (node.isInline || node.isTextblock || node.isAtom || !formatBlockTypes.has(node.type.name)) ok = false;
    return ok;
  });
  return ok;
}

/** Whether `from`–`to` is nothing but whole objects (a table row, the cells of a column…). */
function objectsOnly(doc: Node, from: number, to: number): boolean {
  if (to <= from) return true;
  let ok = true;
  doc.nodesBetween(from, to, (node, pos) => {
    if (!ok) return false;
    const end = pos + node.nodeSize;
    if (isSuggestedObject(node) && pos >= from && end <= to) return false;
    if (pos < from && end > to && !node.isTextblock) return true;
    ok = false;
    return false;
  });
  return ok;
}

/** Whether `from`–`to` holds a whole object (or a footnote reference). */
function hasObject(doc: Node, from: number, to: number): boolean {
  if (to <= from) return false;
  let found = false;
  doc.nodesBetween(from, to, (node, pos) => {
    if (found) return false;
    if ((isSuggestedObject(node) && pos >= from && pos + node.nodeSize <= to) || node.type.name === "footnote") found = true;
    return !found;
  });
  return found;
}

/** The object around `pos` that is itself a pending insertion by `author` (a table being added), if any. */
function pendingObjectAround(doc: Node, pos: number, author: string): SuggestionMeta | null {
  const $pos = doc.resolve(pos);
  for (let depth = $pos.depth; depth > 0; depth--) {
    const inserted = objectSuggestion($pos.node(depth), "insert");
    if (inserted && inserted.author === author) return metaOf(inserted);
  }
  return null;
}

/** A transaction that deletes one image and inserts the same picture elsewhere (dragging it). */
function isImageMove(doc: Node, tr: Transaction): boolean {
  if (tr.steps.length !== 2 || !tr.steps.every((step) => step instanceof ReplaceStep)) return false;
  const [removal, insertion] = tr.steps as ReplaceStep[];
  const removed = removal!.slice.size === 0 ? doc.nodeAt(removal!.from) : null;
  const inserted = insertion!.slice.content.childCount === 1 ? insertion!.slice.content.firstChild : null;
  return (
    removed?.type.name === "image" &&
    removal!.to - removal!.from === removed.nodeSize &&
    inserted?.type.name === "image" &&
    insertion!.from === insertion!.to &&
    inserted.attrs.src === removed.attrs.src
  );
}

type ChangeRecord = {
  fromA: number;
  toA: number;
  fromB: number;
  toB: number;
  /** The kept (struck-through) text in the new document, before the inserted text. */
  deletedFrom: number;
  deletedTo: number;
  insertedFrom: number;
  insertedTo: number;
  /** Number of steps of the new transaction when this change was done. */
  steps: number;
};

/**
 * Compares characters and inline nodes only: block tokens never match, so a diff cannot keep an
 * empty paragraph that a new table replaced as the paragraph in its first cell.
 */
const blockTokensDiffer: TokenEncoder<unknown> = {
  encodeCharacter: (char) => char,
  encodeNodeStart: (node) => (node.isInline ? node.type.name : {}),
  encodeNodeEnd: () => ({}),
  compareTokens: (a, b) => a === b,
};

/** The changes of a transaction, in ranges suggestions can express, or null. */
function suggestableChanges(state: EditorState, tr: Transaction, insert: MarkType): readonly Change[] | null {
  const suggestable = (changes: readonly Change[]) =>
    changes.every(
      (change) => suggestableRange(state.doc, change.fromA, change.toA, insert) && suggestableRange(tr.doc, change.fromB, change.toB, insert),
    );
  const changes = ChangeSet.create(state.doc).addSteps(tr.doc, tr.mapping.maps, null).changes;
  if (suggestable(changes)) return changes;
  // The diff may have matched structure across an inserted or deleted object.
  const coarse = ChangeSet.create(state.doc, undefined, blockTokensDiffer).addSteps(tr.doc, tr.mapping.maps, null).changes;
  return suggestable(coarse) ? coarse : null;
}

function rewriteContent(state: EditorState, tr: Transaction, context: SuggestContext): SuggestResult | null {
  const types = suggestionTypes(state.schema);
  const changes = suggestableChanges(state, tr, types.insert);
  if (!changes || changes.length === 0) return null;

  const out = state.tr;
  let group = context.group;
  let made: string | null = null;
  const records: ChangeRecord[] = [];
  // Changes of whole objects in one edit (the cells of an inserted column) are one suggestion.
  let objectMeta: SuggestionMeta | null = null;
  for (const change of changes) {
    const from = out.mapping.map(change.fromA, 1);
    const to = out.mapping.map(change.toA, 1);
    const structural = objectsOnly(state.doc, change.fromA, change.toA) && objectsOnly(tr.doc, change.fromB, change.toB);
    // Inside an object that is itself being suggested (a new table), edits are part of its insertion.
    const pending = pendingObjectAround(out.doc, from, context.author);
    // An inserted or deleted object is a suggestion of its own, not joined with the edits around it.
    const objects = !pending && (hasObject(state.doc, change.fromA, change.toA) || hasObject(tr.doc, change.fromB, change.toB));
    const meta: SuggestionMeta =
      pending ??
      ((structural && objectMeta) ||
        (objects ? { id: newSuggestionId(), author: context.author, createdAt: context.now } : chooseSuggestion(out.doc, from, to, group, context, types)));
    if (structural || objects) objectMeta = meta;
    const start = out.steps.length;
    if (to > from) {
      if (pending) out.delete(from, to);
      else markDeleted(out, from, to, meta, context.author, types);
    }
    const afterDeletion = out.mapping.slice(start);
    const deletedFrom = afterDeletion.map(from, -1);
    const deletedTo = afterDeletion.map(to, 1);
    let insertedFrom = deletedTo;
    let insertedTo = deletedTo;
    // Deleting across lists can reopen a list where the deletion ends: structure ProseMirror needs to
    // fit the deletion, not content. Suggested, the text stays, and so does the list it is in.
    if (change.toB > change.fromB && !(to > from && wrapperTokensOnly(tr.doc, change.fromB, change.toB))) {
      const before = out.steps.length;
      out.replace(deletedTo, deletedTo, tr.doc.slice(change.fromB, change.toB));
      const step = out.steps[before];
      if (out.steps.length !== before + 1 || !(step instanceof ReplaceStep)) return null;
      step.getMap().forEach((_oldStart, _oldEnd, newStart, newEnd) => {
        insertedFrom = newStart;
        insertedTo = newEnd;
      });
      markInserted(out, insertedFrom, insertedTo, meta, types, pending !== null);
    }
    records.push({ ...change, deletedFrom, deletedTo, insertedFrom, insertedTo, steps: out.steps.length });
    made = meta.id;
    // Typing after an inserted object starts a new suggestion.
    group = objects ? null : { id: meta.id, createdAt: meta.createdAt, time: context.now };
  }

  const direction = tr.getMeta(DELETE_DIRECTION) as -1 | 1 | undefined;
  const backward = (record: ChangeRecord) =>
    direction !== undefined ? direction < 0 : state.selection.empty && state.selection.from === record.toA;
  const map = (pos: number): number => {
    let shift = 0;
    for (const record of records) {
      if (pos < record.fromB) break;
      if (pos <= record.toB) {
        const later = out.mapping.slice(record.steps);
        if (record.toB > record.fromB) return later.map(record.insertedFrom + (pos - record.fromB));
        return backward(record) ? later.map(record.deletedFrom, -1) : later.map(record.deletedTo, 1);
      }
      shift += record.toB - record.fromB - (record.toA - record.fromA);
    }
    return out.mapping.map(pos - shift);
  };
  out.setSelection(mapSelection(tr.selection, out.doc, map));
  return { tr: out, group, made };
}

function mapSelection(selection: Selection, doc: Node, map: (pos: number) => number): Selection {
  const clamp = (pos: number) => Math.max(0, Math.min(pos, doc.content.size));
  try {
    if (selection instanceof NodeSelection) return NodeSelection.create(doc, clamp(map(selection.from)));
    return TextSelection.between(doc.resolve(clamp(map(selection.anchor))), doc.resolve(clamp(map(selection.head))));
  } catch {
    return Selection.near(doc.resolve(clamp(map(selection.head))));
  }
}

/** The suggestion a change at `from`–`to` belongs to: the current group, a pending insertion around it, or a new one. */
function chooseSuggestion(
  doc: Node,
  from: number,
  to: number,
  group: Group | null,
  context: SuggestContext,
  types: SuggestionTypes,
): SuggestionMeta {
  const ids = new Set<string>();
  const addMarks = (node: Node | null | undefined) => {
    for (const mark of node?.marks ?? []) if (mark.type === types.insert || mark.type === types.delete) ids.add(mark.attrs.id);
    for (const kind of ["insert", "delete"] as const) {
      const object = node && !node.isInline ? objectSuggestion(node, kind) : null;
      if (object) ids.add(object.id);
    }
  };
  const addBreak = (node: Node | null | undefined) => {
    const brk = node?.attrs.suggestionBreak as BreakSuggestion | null | undefined;
    if (brk) ids.add(brk.id);
  };
  const $from = doc.resolve(from);
  const $to = doc.resolve(to);
  addMarks($from.nodeBefore);
  addMarks($from.nodeAfter);
  addMarks($to.nodeAfter);
  if (to > from) {
    doc.nodesBetween(from, to, (node) => {
      if (node.isInline || isSuggestedObject(node)) addMarks(node);
      else if (node.isTextblock) addBreak(node);
      return !node.isInline;
    });
  }
  if ($from.parent.isTextblock && $from.parentOffset === 0) addBreak($from.parent);
  if ($to.parent.isTextblock && $to.parentOffset === $to.parent.content.size && $to.depth > 0) {
    const next = Selection.findFrom(doc.resolve($to.after()), 1, true);
    if (next) addBreak(next.$from.parent);
  }
  if (group && context.now - group.time < GROUP_TIMEOUT_MS && ids.has(group.id)) {
    return { id: group.id, author: context.author, createdAt: group.createdAt };
  }
  // Inside a pending insertion: extend it.
  const before = types.insert.isInSet($from.nodeBefore?.marks ?? []);
  const after = types.insert.isInSet($to.nodeAfter?.marks ?? []);
  if (before && after && before.attrs.id === after.attrs.id && before.attrs.author === context.author) {
    return { id: before.attrs.id, author: context.author, createdAt: before.attrs.createdAt };
  }
  return { id: newSuggestionId(), author: context.author, createdAt: context.now };
}

/**
 * Marks `from`–`to` as deleted. Pending insertions by the same author (text, paragraph breaks and
 * objects) are removed instead; content that is already deleted keeps its suggestion.
 */
function markDeleted(out: Transaction, from: number, to: number, meta: SuggestionMeta, author: string, types: SuggestionTypes): void {
  const removals: { from: number; to: number }[] = [];
  const marked: { from: number; to: number }[] = [];
  const objects: number[] = [];
  const breaks: number[] = [];
  const joins: number[] = [];
  out.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isInline) {
      const range = { from: Math.max(pos, from), to: Math.min(pos + node.nodeSize, to) };
      const inserted = types.insert.isInSet(node.marks);
      if (inserted && inserted.attrs.author === author) removals.push(range);
      else if (!types.delete.isInSet(node.marks)) marked.push(range);
      return false;
    }
    if (isSuggestedObject(node) && pos >= from && pos + node.nodeSize <= to) {
      const inserted = objectSuggestion(node, "insert");
      // A cell of a new column stays: removing one cell would leave its row a cell short.
      const cell = node.type.spec.tableRole === "cell" || node.type.spec.tableRole === "header_cell";
      if (inserted && inserted.author === author) {
        if (!cell) removals.push({ from: pos, to: pos + node.nodeSize });
        return cell;
      }
      if (!objectSuggestion(node, "delete")) objects.push(pos);
      return false;
    }
    // The boundary before a textblock whose content starts inside the range is deleted. A whole
    // textblock deleted with nothing before it to join with (the first paragraph) takes the
    // boundary after it instead, with the textblock right after the range.
    if (node.isTextblock && pos + 1 > from && pos + 1 <= to && "suggestionBreak" in node.attrs) {
      const next = pos === from && pos + node.nodeSize === to && !canJoinBackward(out.doc, pos) ? out.doc.nodeAt(to) : null;
      const target = next?.isTextblock && "suggestionBreak" in next.attrs && canJoinBackward(out.doc, to) ? to : pos;
      const brk = out.doc.nodeAt(target)!.attrs.suggestionBreak as BreakSuggestion | null;
      if (brk?.kind === "insert" && brk.author === author) joins.push(target);
      else if (brk?.kind !== "delete") breaks.push(target);
    }
    return true;
  });
  for (const range of marked) out.addMark(range.from, range.to, types.delete.create(meta));
  for (const pos of objects) out.setNodeAttribute(pos, "suggestionDelete", { ...meta });
  for (const pos of breaks) out.setNodeAttribute(pos, "suggestionBreak", { kind: "delete", ...meta });
  const removed = new Set(removals.map((range) => range.from));
  for (const pos of joins) {
    // The textblock before, leaving out those inside objects that are removed (a new table being taken out).
    let end = previousTextblockEnd(out.doc, pos);
    for (let range = removals.find((candidate) => end !== null && candidate.from < end && end < candidate.to); range; ) {
      end = previousTextblockEnd(out.doc, range.from);
      range = removals.find((candidate) => end !== null && candidate.from < end && end < candidate.to);
    }
    // A break that cannot be joined back (a table now lies before it) stays a suggested insertion:
    // clearing it would make the split permanent.
    if (end !== null && joinable(out.doc, end, pos + 1, removed)) removals.push({ from: end, to: pos + 1 });
  }
  // Removed objects can lie inside a join's range: delete each position once.
  removals.sort((a, b) => a.from - b.from);
  const merged: { from: number; to: number }[] = [];
  for (const range of removals) {
    const last = merged[merged.length - 1];
    if (last && range.from <= last.to) last.to = Math.max(last.to, range.to);
    else merged.push({ ...range });
  }
  for (const range of merged.reverse()) out.delete(range.from, range.to);
}

/** Whether the textblock at `pos` can be joined with the textblock before it. */
function canJoinBackward(doc: Node, pos: number): boolean {
  const end = previousTextblockEnd(doc, pos);
  return end !== null && joinable(doc, end, pos + 1);
}

/** The end of the content of the textblock before the one at `pos`. */
function previousTextblockEnd(doc: Node, pos: number): number | null {
  const found = Selection.findFrom(doc.resolve(pos), -1, true);
  return found ? found.$from.end() : null;
}

/**
 * Marks freshly inserted content as an insertion: its inline content gets the mark, whole objects
 * the attribute, and textblocks starting inside it are suggested paragraph breaks. Inside an object
 * that is itself a pending insertion only the marks are added.
 */
function markInserted(out: Transaction, from: number, to: number, meta: SuggestionMeta, types: SuggestionTypes, inPending = false): void {
  out.removeMark(from, to, types.delete);
  out.removeMark(from, to, types.format);
  out.addMark(from, to, types.insert.create(meta));
  out.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isInline) return false;
    if (isSuggestedObject(node) && pos >= from) {
      if (!inPending) {
        out.setNodeAttribute(pos, "suggestionInsert", { ...meta });
        if (node.attrs.suggestionDelete) out.setNodeAttribute(pos, "suggestionDelete", null);
        if (node.attrs.suggestionFormat) out.setNodeAttribute(pos, "suggestionFormat", null);
      }
      return false;
    }
    if (!node.isTextblock) return true;
    if (!inPending && pos >= from && pos < to && "suggestionBreak" in node.attrs) {
      out.setNodeAttribute(pos, "suggestionBreak", { kind: "insert", ...meta });
    }
    return false;
  });
}

/** Applies a formatting transaction as it is and records the formatting before it as format suggestions. */
function rewriteFormat(state: EditorState, tr: Transaction, context: SuggestContext): SuggestResult | null {
  const types = suggestionTypes(state.schema);
  const out = state.tr;
  for (const step of tr.steps) if (out.maybeStep(step).failed) return null;
  out.setSelection(tr.selection.map(out.doc, new Mapping()));

  const textRanges: [number, number][] = [];
  const blockRanges: [number, number][] = [];
  tr.steps.forEach((step: Step, index) => {
    const after = tr.mapping.slice(index + 1);
    if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) {
      if (!isSuggestionType(step.mark.type)) textRanges.push([after.map(step.from, 1), after.map(step.to, -1)]);
    } else if (step instanceof AttrStep) {
      const pos = after.map(step.pos, 1);
      blockRanges.push([pos, pos + 1]);
    } else if (step instanceof ReplaceStep) {
      // A leaf object's new attributes (isLeafMarkupChange).
      const pos = after.map(step.from, 1);
      blockRanges.push([pos, pos + 1]);
    } else if (step instanceof ReplaceAroundStep) {
      const mapping = tr.mapping.slice(index);
      blockRanges.push([mapping.map(step.from, -1), mapping.map(step.to, 1)]);
    }
  });
  const inverse = tr.mapping.invert();
  let created: SuggestionMeta | null = null;
  let made: string | null = null;
  const record = (meta: SuggestionMeta) => {
    made ??= meta.id;
    return meta;
  };
  const fresh = () => record((created ??= { id: newSuggestionId(), author: context.author, createdAt: context.now }));
  recordTextFormat(state.doc, out, textRanges, tr.mapping, inverse, context.author, types, fresh, record);
  recordBlockFormat(state.doc, out, blockRanges, inverse, context.author, fresh, record);
  recordImageFormat(state.doc, out, blockRanges, inverse, context.author, fresh, record);
  return { tr: out, group: context.group, made };
}

function metaOf(value: SuggestionMeta): SuggestionMeta {
  return { id: value.id, author: value.author, createdAt: value.createdAt };
}

function sameFormatting(a: MarkJSON[], b: MarkJSON[]): boolean {
  const key = (marks: MarkJSON[]) => marks.map((mark) => JSON.stringify([mark.type, mark.attrs ?? {}])).sort();
  return sameJSON(key(a), key(b));
}

function recordTextFormat(
  oldDoc: Node,
  out: Transaction,
  ranges: [number, number][],
  forward: Mapping,
  inverse: Mapping,
  author: string,
  types: SuggestionTypes,
  fresh: () => SuggestionMeta,
  record: (meta: SuggestionMeta) => SuggestionMeta,
): void {
  const segments: { from: number; to: number; node: Node }[] = [];
  let existingMeta: SuggestionMeta | null = null;
  for (const [from, to] of ranges) {
    if (to <= from) continue;
    const oldFrom = inverse.map(from, 1);
    const oldTo = inverse.map(to, -1);
    oldDoc.nodesBetween(oldFrom, oldTo, (node, pos) => {
      if (!node.isInline) return true;
      const start = Math.max(pos, oldFrom);
      const end = Math.min(pos + node.nodeSize, oldTo);
      if (end <= start) return false;
      const inserted = types.insert.isInSet(node.marks);
      // Formatting a pending insertion of the same author changes it directly.
      if (inserted && inserted.attrs.author === author) return false;
      const existing = types.format.isInSet(node.marks);
      if (existing && !existingMeta) existingMeta = metaOf(existing.attrs as SuggestionMeta);
      segments.push({ from: start, to: end, node });
      return false;
    });
  }
  for (const { from, to, node } of segments) {
    const newFrom = forward.map(from, 1);
    const newTo = forward.map(to, -1);
    const current = out.doc.nodeAt(newFrom);
    if (!current || newTo <= newFrom) continue;
    const existing: Mark | undefined = types.format.isInSet(node.marks);
    const before = existing ? (existing.attrs.before as MarkJSON[]) : formatMarks(node.marks);
    if (sameFormatting(before, formatMarks(current.marks))) {
      out.removeMark(newFrom, newTo, types.format);
    } else {
      const meta = existing ? record(metaOf(existing.attrs as SuggestionMeta)) : existingMeta ? record(existingMeta) : fresh();
      out.addMark(newFrom, newTo, types.format.create({ ...meta, before }));
    }
  }
}

function recordBlockFormat(
  oldDoc: Node,
  out: Transaction,
  ranges: [number, number][],
  inverse: Mapping,
  author: string,
  fresh: () => SuggestionMeta,
  record: (meta: SuggestionMeta) => SuggestionMeta,
): void {
  const seen = new Set<number>();
  const doc = out.doc;
  for (const [from, to] of ranges) {
    doc.nodesBetween(Math.max(0, from), Math.min(to, doc.content.size), (node, pos) => {
      if (!node.isTextblock) return true;
      if (seen.has(pos) || !("suggestionFormat" in node.attrs)) return false;
      seen.add(pos);
      const oldPos = inverse.map(pos, 1);
      const old = oldDoc.nodeAt(oldPos);
      if (!old?.isTextblock || !("suggestionFormat" in old.attrs)) return false;
      const brk = old.attrs.suggestionBreak as BreakSuggestion | null;
      if (brk && !node.attrs.suggestionBreak) out.setNodeAttribute(pos, "suggestionBreak", brk);
      // A paragraph that is itself a pending insertion is formatted directly.
      if (brk?.kind === "insert" && brk.author === author) return false;
      const existing = old.attrs.suggestionFormat as FormatSuggestion | null;
      const before = existing?.before ?? blockFormat(oldDoc, oldPos);
      const after = blockFormat(out.doc, pos);
      if (!before || !after) return false;
      if (sameJSON(before, after)) {
        if (out.doc.nodeAt(pos)?.attrs.suggestionFormat) out.setNodeAttribute(pos, "suggestionFormat", null);
      } else {
        out.setNodeAttribute(pos, "suggestionFormat", { ...(existing ? record(metaOf(existing)) : fresh()), before });
      }
      return false;
    });
  }
}

/** An image's attributes without its suggestions: what a "Format: image" suggestion restores. */
function imageAttributes(node: Node): Record<string, unknown> {
  const { suggestionInsert: _insert, suggestionDelete: _delete, suggestionFormat: _format, ...attrs } = node.attrs;
  return attrs;
}

/** Records changes of images' size, wrapping, rotation, crop… as "Format: image" suggestions holding the values before. */
function recordImageFormat(
  oldDoc: Node,
  out: Transaction,
  ranges: [number, number][],
  inverse: Mapping,
  author: string,
  fresh: () => SuggestionMeta,
  record: (meta: SuggestionMeta) => SuggestionMeta,
): void {
  const seen = new Set<number>();
  const doc = out.doc;
  for (const [from, to] of ranges) {
    doc.nodesBetween(Math.max(0, from), Math.min(to, doc.content.size), (node, pos) => {
      if (node.type.name !== "image") return !node.isTextblock;
      if (seen.has(pos)) return false;
      seen.add(pos);
      const old = oldDoc.nodeAt(inverse.map(pos, 1));
      if (old?.type.name !== "image") return false;
      // An image that is itself a pending insertion is changed directly.
      const inserted = objectSuggestion(old, "insert");
      if (inserted && inserted.author === author) return false;
      const existing = old.attrs.suggestionFormat as ImageFormatSuggestion | null;
      const before = existing?.before ?? imageAttributes(old);
      const after = imageAttributes(node);
      const changed = Object.keys(after).some((key) => !sameJSON(before[key] ?? null, after[key] ?? null));
      if (!changed) {
        if (node.attrs.suggestionFormat) out.setNodeAttribute(pos, "suggestionFormat", null);
      } else {
        // The values before the first change, for the attributes that changed since.
        const kept = Object.fromEntries(Object.keys(after).filter((key) => key in before).map((key) => [key, before[key] ?? null]));
        out.setNodeAttribute(pos, "suggestionFormat", { ...(existing ? record(metaOf(existing)) : fresh()), before: kept });
      }
      return false;
    });
  }
}

/** Whether a transaction may add, change or remove suggestions (so the list must be read again). */
function touchesSuggestions(tr: Transaction): boolean {
  if (tr.getMeta(REWRITTEN) || tr.getMeta(SUGGESTION_COMMAND)) return true;
  return tr.steps.some((step) => {
    if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) return isSuggestionType(step.mark.type);
    if (step instanceof AttrStep) return step.attr.startsWith("suggestion") || (step.attr === "content" && regionHasSuggestions(step.value));
    // Header and footer content with suggestions.
    if (step instanceof DocAttrStep) return (regionKeys as readonly string[]).includes(step.attr) && regionHasSuggestions(step.value);
    if (step instanceof ReplaceStep || step instanceof ReplaceAroundStep) return sliceHasSuggestions(step.slice);
    return false;
  });
}

const suggestionAttributes = ["suggestionFormat", "suggestionBreak", "suggestionInsert", "suggestionDelete"];

function sliceHasSuggestions(slice: Slice): boolean {
  let found = false;
  slice.content.descendants((node) => {
    if (found) return false;
    if (node.isInline) found = node.marks.some((mark) => isSuggestionType(mark.type)) || (node.type.name === "footnote" && regionHasSuggestions(node.attrs.content));
    else found = suggestionAttributes.some((name) => !!node.attrs[name]);
    return !found;
  });
  return found;
}

/** Accepts or rejects suggestions (all when `ids` is null) in one undo step. */
export function resolveSuggestions(state: EditorState, action: "accept" | "reject", ids: string[] | null): Transaction | null {
  const tr = state.tr;
  closeHistory(tr);
  applySuggestions(tr, action, ids && new Set(ids));
  if (!tr.docChanged) return null;
  return tr.setMeta(SUGGESTION_COMMAND, true).scrollIntoView();
}

/** The suggestion of the content at `pos`, if any. */
export function suggestionAt(state: EditorState, pos: number): string | null {
  const $pos = state.doc.resolve(pos);
  for (const node of [$pos.nodeAfter, $pos.nodeBefore]) {
    for (const mark of node?.marks ?? []) if (isSuggestionType(mark.type)) return mark.attrs.id as string;
  }
  const block = $pos.parent;
  const format = block.attrs.suggestionFormat as FormatSuggestion | null | undefined;
  if (format) return format.id;
  // An object at or around the position: a clicked image, a cell of a suggested row or table.
  const objectId = (node: Node | null | undefined) => {
    if (!node || !isSuggestedObject(node)) return null;
    const meta = objectSuggestion(node, "insert") ?? objectSuggestion(node, "delete") ?? (node.attrs.suggestionFormat as SuggestionMeta | null);
    return meta?.id ?? null;
  };
  const after = objectId($pos.nodeAfter);
  if (after) return after;
  for (let depth = $pos.depth; depth > 0; depth--) {
    const id = objectId($pos.node(depth));
    if (id) return id;
  }
  return null;
}

/**
 * Backspace and Delete in Suggesting mode step over struck-through text, so the next character
 * is deleted instead of nothing happening.
 */
function deleteSkippingSuggestions(editor: Editor, direction: -1 | 1): boolean {
  const { state, view } = editor;
  if (getSuggesting(state).mode !== "suggesting" || !state.selection.empty) return false;
  const deleted = state.schema.marks.suggestionDelete!;
  const $cursor = state.selection.$from;
  if (!$cursor.parent.isTextblock) return false;
  const start = $cursor.start();
  const end = $cursor.end();
  let pos = $cursor.pos;
  const neighbour = (at: number) => {
    const $at = state.doc.resolve(at);
    return direction < 0 ? $at.nodeBefore : $at.nodeAfter;
  };
  while (direction < 0 ? pos > start : pos < end) {
    const node = neighbour(pos);
    if (!node || !deleted.isInSet(node.marks)) break;
    pos += direction * node.nodeSize;
  }
  if (pos === $cursor.pos) return false;
  // At the edge of the paragraph: the usual Backspace or Delete joins the paragraphs from there.
  if (pos === (direction < 0 ? start : end)) {
    view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, pos)));
    return false;
  }
  const node = neighbour(pos)!;
  let size = node.isText ? 1 : node.nodeSize;
  if (node.isText) {
    const text = node.text!;
    const code = direction < 0 ? text.charCodeAt(text.length - 1) : text.charCodeAt(0);
    if (direction < 0 ? code >= 0xdc00 && code <= 0xdfff : code >= 0xd800 && code <= 0xdbff) size = 2;
  }
  const from = direction < 0 ? pos - size : pos;
  const to = direction < 0 ? pos : pos + size;
  view.dispatch(state.tr.delete(from, to).setMeta(DELETE_DIRECTION, direction).scrollIntoView());
  return true;
}

type SuggestingOptions = {
  initialMode: EditorMode;
  author: string;
  /** A click in the document: on suggested text (its id) or elsewhere (null). */
  onActivate: (id: string | null) => void;
};

export const Suggesting = Extension.create<SuggestingOptions>({
  name: "suggesting",

  addOptions() {
    return { initialMode: "editing", author: SUGGESTION_AUTHOR, onActivate: () => {} };
  },

  dispatchTransaction({ transaction, next }) {
    const state = this.editor.state;
    const suggesting = getSuggesting(state);
    if (!transaction.docChanged) return next(transaction);
    const command = transaction.getMeta(SUGGESTION_COMMAND) === true || transaction.getMeta("addToHistory") === false;
    // Viewing mode and the previews are read-only, whatever the menus try.
    if (suggesting.readOnly && !command) return;
    if (suggesting.mode !== "suggesting") return next(transaction);
    const context = { author: this.options.author, now: Date.now(), group: suggesting.group };
    next(suggestTransaction(state, transaction, context)?.tr ?? transaction);
  },

  addKeyboardShortcuts() {
    return {
      Backspace: () => deleteSkippingSuggestions(this.editor, -1),
      Delete: () => deleteSkippingSuggestions(this.editor, 1),
    };
  },

  addProseMirrorPlugins() {
    const { initialMode, onActivate } = this.options;
    return [
      new Plugin<SuggestingState>({
        key: suggestingKey,
        state: {
          init: (_config, state) => ({
            ...emptyState,
            mode: initialMode,
            readOnly: initialMode === "viewing",
            suggestions: collectSuggestions(state.doc),
          }),
          apply(tr, value, _old, state) {
            let next = value;
            if (tr.docChanged && (value.suggestions.length > 0 || touchesSuggestions(tr))) {
              next = { ...next, suggestions: collectSuggestions(state.doc) };
            }
            const meta = tr.getMeta(suggestingKey) as SuggestingMeta | undefined;
            if (meta) {
              // A suggestion activated by a click or a card stays active wherever the cursor goes.
              const followsCursor = meta.activeFollowsCursor ?? (meta.activeId === undefined && next.activeFollowsCursor);
              next = { ...next, ...meta, activeFollowsCursor: followsCursor };
            }
            if (next.activeId === null) return next;
            const active = next.suggestions.find((suggestion) => suggestion.id === next.activeId);
            if (!active) return { ...next, activeId: null, activeFollowsCursor: false };
            // The suggestion being made stops being active when the cursor moves away from it (a
            // header's or footnote's suggestion follows the cursor of its own editor).
            if (next.activeFollowsCursor && !active.region && meta?.activeId === undefined && (tr.selectionSet || tr.docChanged)) {
              const { head } = state.selection;
              // Right after an inserted object the cursor is at the start of the next paragraph.
              const after = active.nodes.length > 0 ? active.to + 1 : active.to;
              if (head < active.from || head > after) return { ...next, activeId: null, activeFollowsCursor: false };
            }
            return next;
          },
        },
        props: {
          transformPasted: (slice) => stripSuggestions(slice),
          decorations(state) {
            const { suggestions, activeId } = getSuggesting(state);
            if (suggestions.length === 0) return DecorationSet.empty;
            const decorations: Decoration[] = [];
            for (const suggestion of suggestions) {
              if (suggestion.id === activeId) {
                for (const range of suggestion.ranges) {
                  decorations.push(Decoration.inline(range.from, range.to, { class: "suggestion-active" }));
                }
              }
              // Inserted, deleted and reformatted objects: node views draw their own DOM, so the
              // classes come from decorations rather than the attributes.
              for (const { pos, size, kind } of suggestion.nodes) {
                const active = suggestion.id === activeId ? " suggestion-active" : "";
                decorations.push(Decoration.node(pos, pos + size, { class: `suggestion-node-${kind}${active}` }));
              }
              // A mark at the end of the paragraph before a suggested paragraph break. An object put
              // in place of an empty paragraph is outlined itself; its break needs no mark.
              const objectOnly = suggestion.insertedObjects.length > 0 && !suggestion.inserted && !suggestion.deleted;
              for (const { pos, kind } of objectOnly ? [] : suggestion.breaks) {
                const active = suggestion.id === activeId ? " suggestion-active" : "";
                decorations.push(
                  Decoration.widget(pos, () => breakMark(kind, active), { side: 1, key: `${kind}${suggestion.id}${active}`, marks: [] }),
                );
              }
            }
            return DecorationSet.create(state.doc, decorations);
          },
          handleClick(view, pos) {
            onActivate(suggestionAt(view.state, pos));
            return false;
          },
        },
      }),
    ];
  },
});

function breakMark(kind: "insert" | "delete", active: string): HTMLElement {
  const mark = document.createElement("span");
  mark.className = `suggestion-break suggestion-break-${kind}${active}`;
  mark.textContent = "¶";
  mark.setAttribute("aria-hidden", "true");
  mark.contentEditable = "false";
  return mark;
}
