// Suggesting mode: rewrites edits into suggestions before they are applied, keeps the list of
// suggestions for the cards, highlights the active one and accepts or rejects them.
// See docs/design/suggesting.md.
import {
  applySuggestions,
  blockFormat,
  collectSuggestions,
  formatMarks,
  joinable,
  newSuggestionId,
  sameJSON,
  stripSuggestions,
  SUGGESTION_AUTHOR,
  type BreakSuggestion,
  type FormatSuggestion,
  type MarkJSON,
  type Suggestion,
  type SuggestionMeta,
} from "@docs/shared";
import { Extension, type Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { ChangeSet } from "@tiptap/pm/changeset";
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
    tr.steps.every((step) => step instanceof DocAttrStep)
  );
}

/**
 * The transaction as suggestions, built from `state`, or null when it should be applied as it is
 * (it does not change the document, or changes structure that suggestions cannot express).
 */
export function suggestTransaction(state: EditorState, tr: Transaction, context: SuggestContext): SuggestResult | null {
  if (passesThrough(tr) || tr.before !== state.doc) return null;
  const replaces = tr.steps.some((step) => step instanceof ReplaceStep);
  const wraps = tr.steps.some((step) => step instanceof ReplaceAroundStep);
  const result = replaces && !wraps ? rewriteContent(state, tr, context) : !replaces ? rewriteFormat(state, tr, context) : null;
  if (!result) return null;
  copyTransactionState(tr, result.tr);
  result.tr.setMeta(REWRITTEN, true);
  setSuggesting(result.tr, result.made ? { group: result.group, activeId: result.made, activeFollowsCursor: true } : { group: result.group });
  return result;
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

/** Whether `from`–`to` holds only inline content (in textblocks that allow suggestion marks) and list structure. */
function inlineRange(doc: Node, from: number, to: number, insert: MarkType): boolean {
  if (to <= from) return true;
  let ok = true;
  doc.nodesBetween(from, to, (node, pos) => {
    if (!ok || node.isInline) return false;
    if (node.isTextblock) {
      if (!node.type.allowsMarkType(insert) || !("suggestionBreak" in node.attrs)) ok = false;
      return false;
    }
    // Ancestors around the whole range, and list structure.
    if ((pos < from && pos + node.nodeSize > to) || listTypes.has(node.type.name)) return true;
    ok = false;
    return false;
  });
  return ok;
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

function rewriteContent(state: EditorState, tr: Transaction, context: SuggestContext): SuggestResult | null {
  const types = suggestionTypes(state.schema);
  const changes = ChangeSet.create(state.doc).addSteps(tr.doc, tr.mapping.maps, null).changes;
  if (changes.length === 0) return null;
  for (const change of changes) {
    if (!inlineRange(state.doc, change.fromA, change.toA, types.insert) || !inlineRange(tr.doc, change.fromB, change.toB, types.insert)) {
      return null;
    }
  }

  const out = state.tr;
  let group = context.group;
  const records: ChangeRecord[] = [];
  for (const change of changes) {
    const from = out.mapping.map(change.fromA, 1);
    const to = out.mapping.map(change.toA, 1);
    const meta = chooseSuggestion(out.doc, from, to, group, context, types);
    const start = out.steps.length;
    if (to > from) markDeleted(out, from, to, meta, context.author, types);
    const afterDeletion = out.mapping.slice(start);
    const deletedFrom = afterDeletion.map(from, -1);
    const deletedTo = afterDeletion.map(to, 1);
    let insertedFrom = deletedTo;
    let insertedTo = deletedTo;
    if (change.toB > change.fromB) {
      const before = out.steps.length;
      out.replace(deletedTo, deletedTo, tr.doc.slice(change.fromB, change.toB));
      const step = out.steps[before];
      if (out.steps.length !== before + 1 || !(step instanceof ReplaceStep)) return null;
      step.getMap().forEach((_oldStart, _oldEnd, newStart, newEnd) => {
        insertedFrom = newStart;
        insertedTo = newEnd;
      });
      markInserted(out, insertedFrom, insertedTo, meta, types);
    }
    records.push({ ...change, deletedFrom, deletedTo, insertedFrom, insertedTo, steps: out.steps.length });
    group = { id: meta.id, createdAt: meta.createdAt, time: context.now };
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
  return { tr: out, group, made: group?.id ?? null };
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
      if (node.isInline) addMarks(node);
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
 * Marks `from`–`to` as deleted. Pending insertions by the same author (text and paragraph breaks)
 * are removed instead; text that is already deleted keeps its suggestion.
 */
function markDeleted(out: Transaction, from: number, to: number, meta: SuggestionMeta, author: string, types: SuggestionTypes): void {
  const removals: { from: number; to: number }[] = [];
  const marked: { from: number; to: number }[] = [];
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
    // The boundary before a textblock whose content starts inside the range is deleted.
    if (node.isTextblock && pos + 1 > from && pos + 1 <= to && "suggestionBreak" in node.attrs) {
      const brk = node.attrs.suggestionBreak as BreakSuggestion | null;
      if (brk?.kind === "insert" && brk.author === author) joins.push(pos);
      else if (brk?.kind !== "delete") breaks.push(pos);
    }
    return true;
  });
  for (const range of marked) out.addMark(range.from, range.to, types.delete.create(meta));
  for (const pos of breaks) out.setNodeAttribute(pos, "suggestionBreak", { kind: "delete", ...meta });
  for (const pos of joins) {
    const end = previousTextblockEnd(out.doc, pos);
    if (end !== null && joinable(out.doc, end, pos + 1)) removals.push({ from: end, to: pos + 1 });
    else out.setNodeAttribute(pos, "suggestionBreak", null);
  }
  removals.sort((a, b) => b.from - a.from);
  for (const range of removals) out.delete(range.from, range.to);
}

/** The end of the content of the textblock before the one at `pos`. */
function previousTextblockEnd(doc: Node, pos: number): number | null {
  const found = Selection.findFrom(doc.resolve(pos), -1, true);
  return found ? found.$from.end() : null;
}

/** Marks freshly inserted content as an insertion; textblocks starting inside it are suggested paragraph breaks. */
function markInserted(out: Transaction, from: number, to: number, meta: SuggestionMeta, types: SuggestionTypes): void {
  out.removeMark(from, to, types.delete);
  out.removeMark(from, to, types.format);
  out.addMark(from, to, types.insert.create(meta));
  out.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    if (pos >= from && pos < to && "suggestionBreak" in node.attrs) {
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

/** Whether a transaction may add, change or remove suggestions (so the list must be read again). */
function touchesSuggestions(tr: Transaction): boolean {
  if (tr.getMeta(REWRITTEN) || tr.getMeta(SUGGESTION_COMMAND)) return true;
  return tr.steps.some((step) => {
    if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) return isSuggestionType(step.mark.type);
    if (step instanceof AttrStep) return step.attr.startsWith("suggestion");
    if (step instanceof ReplaceStep || step instanceof ReplaceAroundStep) return sliceHasSuggestions(step.slice);
    return false;
  });
}

function sliceHasSuggestions(slice: Slice): boolean {
  let found = false;
  slice.content.descendants((node) => {
    if (found) return false;
    if (node.isInline) found = node.marks.some((mark) => isSuggestionType(mark.type));
    else if (node.isTextblock && (node.attrs.suggestionFormat || node.attrs.suggestionBreak)) found = true;
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
  return format?.id ?? null;
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
            // The suggestion being made stops being active when the cursor moves away from it.
            if (next.activeFollowsCursor && meta?.activeId === undefined && (tr.selectionSet || tr.docChanged)) {
              const { head } = state.selection;
              if (head < active.from || head > active.to) return { ...next, activeId: null, activeFollowsCursor: false };
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
              // A mark at the end of the paragraph before a suggested paragraph break.
              for (const { pos, kind } of suggestion.breaks) {
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
