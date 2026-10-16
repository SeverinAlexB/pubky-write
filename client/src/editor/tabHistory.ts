// Undo and redo per document tab (spec 18, amendment of round 5; docs/design/document-tabs.md).
//
// Every change is recorded in the timeline of the tab it changes, or in the shared timeline when
// it changes the document as a whole (page setup, columns, headers and footers, adding, deleting,
// moving or renaming tabs) or several tabs at once. ⌘Z undoes the latest change of the shown tab's
// timeline and the shared one together, so edits in other tabs stay and a document-wide action is
// undone when it is the latest change seen from the shown tab.
//
// Undoing a change that is not the latest one in the document (later changes were made in other
// tabs, or came from the server) maps its inverse over everything since, as prosemirror-history
// does for remote changes: the events keep their steps' maps and inverses, and a log of every
// change's maps lets an event be moved to the current document when it is undone.
import { DOCUMENT_TAB, FIRST_TAB_ID, hasTabNodes, tabAtPos } from "@pubky-write/shared";
import { Extension } from "@tiptap/core";
import { closeHistory as closeLibraryHistory } from "@tiptap/pm/history";
import type { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Command, type EditorState, type SelectionBookmark, type Transaction } from "@tiptap/pm/state";
import { AddMarkStep, AttrStep, DocAttrStep, Mapping, RemoveMarkStep, ReplaceAroundStep, ReplaceStep, type Step, type StepMap } from "@tiptap/pm/transform";
import { keyBinding, keyBindings } from "../shortcuts.ts";
import { currentTabId } from "./documentTabs.ts";

/** The timeline of document-wide changes. */
export const SHARED = "shared";

type HistoryEvent = {
  /** The tab whose timeline it is in, or SHARED. */
  tab: string;
  /** Its steps' maps, in order. */
  maps: StepMap[];
  /** Each step's inverse, valid on the document right after that step. */
  inverses: Step[];
  /** The log length just after its last step: the changes since are the log from here. */
  at: number;
  /** The selection before it, restored when it is undone. */
  selection: SelectionBookmark;
  /** Steps the collab plugin dropped when it rebased them (they no longer applied): not undone. */
  dropped?: readonly number[];
  /** Order of the events: the latest of a timeline is undone first. */
  seq: number;
};

type HistoryState = {
  done: HistoryEvent[];
  undone: HistoryEvent[];
  /** The maps of every change, from `base` on (shared between states; see `logLength`). */
  log: Mapping;
  base: number;
  /** How many of `log`'s maps belong to this state (later states may have appended more). */
  logLength: number;
  /**
   * The unconfirmed steps as the collab plugin last rebased them: the log index of each rebased
   * copy to the log index of the step as first made (which its event knows).
   */
  copies: ReadonlyMap<number, number>;
  seq: number;
  /** The event the next change may join: within the group delay, adjacent, in the same tab. */
  prev: { seq: number; time: number; composition: unknown; ranges: number[] } | null;
};

/**
 * An undo or redo: the event it took, the event it makes for the other list, and for each of its
 * steps the index of the event's step it inverts (its map mirrors that step's map in the log).
 */
type HistoryMeta = { kind: "undo" | "redo"; seq: number; event: Omit<HistoryEvent, "at" | "seq">; mirrors: number[]; source: { at: number; count: number } };

export const tabHistoryKey = new PluginKey<HistoryState>("tabHistory");
const CLOSE = "tabHistoryClose";
/** prosemirror-history's metadata on undo and redo, which other plugins look for. */
const HISTORY_META = "history$";

const DEPTH = 100;
const NEW_GROUP_DELAY = 500;

/** Starts a new undo step with the next change (also for prosemirror-history, which the tests use). */
export function closeHistory(tr: Transaction): Transaction {
  return closeLibraryHistory(tr).setMeta(CLOSE, true);
}

/** The timeline a transaction's changes belong to. */
export function timelineOf(tr: Transaction): string {
  let result: string | null = null;
  tr.steps.forEach((step, index) => {
    const tab = stepTimeline(step, tr.docs[index]!);
    result = result === null || result === tab ? tab : SHARED;
  });
  return result ?? SHARED;
}

function stepTimeline(step: Step, doc: Node): string {
  if (step instanceof DocAttrStep) return SHARED;
  if (!hasTabNodes(doc)) {
    // Giving the document its tab nodes is a tab command (shared); anything else is in its one tab.
    if (step instanceof ReplaceAroundStep && step.from === 0 && step.to === doc.content.size && step.slice.content.firstChild?.type.name === DOCUMENT_TAB) return SHARED;
    return FIRST_TAB_ID;
  }
  let from: number;
  let to: number;
  if (step instanceof ReplaceStep || step instanceof ReplaceAroundStep || step instanceof AddMarkStep || step instanceof RemoveMarkStep) {
    ({ from, to } = step);
  } else if (step instanceof AttrStep) {
    if (doc.nodeAt(step.pos)?.type.name === DOCUMENT_TAB) return SHARED;
    from = to = step.pos;
  } else {
    const pos = (step as unknown as { pos?: number }).pos;
    if (typeof pos !== "number") return SHARED;
    from = to = pos;
  }
  const tab = tabAtPos(doc, from);
  return tab && to <= tab.to && from >= tab.from ? tab.id : SHARED;
}

const inTimeline = (event: HistoryEvent, tab: string) => event.tab === tab || event.tab === SHARED;

/** The latest event of the shown tab's timeline in `list` (with the shared one), or -1. */
function latest(list: readonly HistoryEvent[], tab: string): number {
  for (let index = list.length - 1; index >= 0; index--) if (inTimeline(list[index]!, tab)) return index;
  return -1;
}

/** The changes after `at` (a log length), appended to `mapping` with their mirrors. */
function appendSince(mapping: Mapping, history: HistoryState, at: number): void {
  // (Mapping.appendMapping reads all of a sliced mapping's maps, so the range is copied by hand.)
  const from = Math.max(0, at - history.base);
  const start = mapping.maps.length;
  for (let index = from; index < history.logLength; index++) {
    const mirror = history.log.getMirror(index);
    mapping.appendMap(history.log.maps[index]!, mirror !== undefined && mirror >= from && mirror < index ? start + mirror - from : undefined);
  }
}

function historyCommand(redo: boolean): Command {
  return (state, dispatch) => {
    const history = tabHistoryKey.getState(state);
    if (!history) return false;
    const tab = currentTabId(state);
    const list = redo ? history.undone : history.done;
    const index = latest(list, tab);
    if (index < 0) return false;
    if (!dispatch) return true;
    const event = list[index]!;
    // The event's own maps, then everything since: each inverse is mapped over the steps after its
    // own, the changes since and the inverses already applied (which mirror their steps).
    // The event's own maps as the log has them (with the rebases that mirror them), then everything since.
    const own = event.at - event.maps.length;
    const remap = new Mapping(own >= history.base ? [] : [...event.maps]);
    appendSince(remap, history, own >= history.base ? own : event.at);
    const tr = state.tr;
    const maps: StepMap[] = [];
    const inverses: Step[] = [];
    const mirrors: number[] = [];
    for (let k = event.maps.length - 1; k >= 0; k--) {
      if (event.dropped?.includes(k)) continue;
      const step = event.inverses[k]!.map(remap.slice(k + 1));
      if (!step) continue;
      const before = tr.doc;
      if (tr.maybeStep(step).failed) continue;
      remap.appendMap(step.getMap(), k);
      maps.push(step.getMap());
      inverses.push(step.invert(before));
      mirrors.push(k);
    }
    const selection = event.selection.map(remap).resolve(tr.doc);
    tr.setSelection(selection).scrollIntoView();
    const meta: HistoryMeta = {
      kind: redo ? "redo" : "undo",
      seq: event.seq,
      event: { tab: event.tab, maps, inverses, selection: state.selection.getBookmark() },
      mirrors,
      source: { at: event.at, count: event.maps.length },
    };
    dispatch(tr.setMeta(tabHistoryKey, meta).setMeta(HISTORY_META, { redo }));
    return true;
  };
}

export const undo: Command = historyCommand(false);
export const redo: Command = historyCommand(true);

/** Whether undo (or redo) is possible in the shown tab. */
export const undoDepth = (state: EditorState) => tabHistoryKey.getState(state)?.done.filter((event) => inTimeline(event, currentTabId(state))).length ?? 0;
export const redoDepth = (state: EditorState) => tabHistoryKey.getState(state)?.undone.filter((event) => inTimeline(event, currentTabId(state))).length ?? 0;

/**
 * Appends a transaction's maps to the log, copying the log if a later state already extended it.
 * `mirrorOf(i)` is the log index (from `base`) of the map the i-th step's map mirrors, if any: an
 * undone step's map mirrors the step's, so changes made before it map through the pair unchanged.
 */
function withLog(history: HistoryState, tr: Transaction, mirrorOf: (index: number) => number | undefined = () => undefined): HistoryState {
  let { log } = history;
  if (log.maps.length !== history.logLength) {
    const copy = new Mapping();
    appendSince(copy, history, history.base);
    log = copy;
  }
  const start = log.maps.length;
  // The collab plugin's rebase starts with the inverses of the unconfirmed steps, which are the
  // last changes in the log (latest first): they mirror them, like the steps redone after.
  const rebased = (tr.getMeta("rebased") as number | undefined) ?? 0;
  tr.mapping.maps.forEach((map, index) => {
    const internal = tr.mapping.getMirror(index);
    const mirror = mirrorOf(index) ?? (index < rebased ? start - 1 - index : internal !== undefined && internal < index ? start + internal : undefined);
    log.appendMap(map, mirror !== undefined && mirror >= 0 ? mirror : undefined);
  });
  return { ...history, log, logLength: log.maps.length };
}

const end = (history: HistoryState) => history.base + history.logLength;

/** The ranges the last step of a transaction changed, for grouping (as prosemirror-history). */
function rangesOf(maps: readonly StepMap[]): number[] {
  const result: number[] = [];
  for (let index = maps.length - 1; index >= 0 && result.length === 0; index--) maps[index]!.forEach((_from, _to, from, to) => result.push(from, to));
  return result;
}

function isAdjacent(tr: Transaction, ranges: number[]): boolean {
  let adjacent = false;
  tr.mapping.maps[0]?.forEach((start, stop) => {
    for (let index = 0; index < ranges.length; index += 2) if (start <= ranges[index + 1]! && stop >= ranges[index]!) adjacent = true;
  });
  return adjacent;
}

/**
 * After the collab plugin rebased the unconfirmed steps (the last `count` changes in the log before
 * `logEnd`), the ones it dropped have no redone step mirroring their inverse: the events they
 * belong to must not undo them any more (their undo would put back text that was never removed).
 */
function withDropped(history: HistoryState, tr: Transaction, count: number, logEnd: number): HistoryState {
  const dropped: number[] = [];
  // Each rebase rebases all unconfirmed steps, so only the copies it makes are needed later.
  const copies = new Map<number, number>();
  for (let index = 0; index < count; index++) {
    const step = logEnd - 1 - index;
    const original = history.copies.get(step) ?? step;
    const mirror = tr.mapping.getMirror(index);
    if (mirror === undefined || mirror < count) dropped.push(original);
    else copies.set(logEnd + mirror, original);
  }
  history = { ...history, copies };
  if (dropped.length === 0) return history;
  const mark = (event: HistoryEvent): HistoryEvent => {
    const first = event.at - event.maps.length;
    const steps = dropped.filter((index) => index >= first && index < event.at).map((index) => index - first);
    return steps.length === 0 ? event : { ...event, dropped: [...(event.dropped ?? []), ...steps] };
  };
  return { ...history, done: history.done.map(mark), undone: history.undone.map(mark) };
}

/** Keeps at most DEPTH events per timeline and drops the log nobody needs any more. */
function trimmed(history: HistoryState, tab: string): HistoryState {
  let { done } = history;
  if (done.filter((event) => event.tab === tab).length > DEPTH) {
    const oldest = done.findIndex((event) => event.tab === tab);
    done = done.filter((_event, index) => index !== oldest);
  }
  const events = [...done, ...history.undone];
  const needed = events.length === 0 ? end(history) : Math.min(...events.map((event) => event.at));
  // Copying the log is linear, so only when a good part of it is no longer needed.
  if (needed - history.base > 1000 && needed - history.base > history.logLength / 2) {
    const log = new Mapping();
    appendSince(log, history, needed);
    return { ...history, done, log, base: needed, logLength: log.maps.length };
  }
  return { ...history, done };
}

function apply(tr: Transaction, value: HistoryState, oldState: EditorState): HistoryState {
  const meta = tr.getMeta(tabHistoryKey) as HistoryMeta | undefined;
  const appended = tr.getMeta("appendedTransaction") as Transaction | undefined;
  let history = value;
  if (tr.getMeta(CLOSE) || appended?.getMeta(CLOSE)) history = { ...history, prev: null };
  if (meta) {
    // Undo moves the event to the redo list, redo back; both keep their timeline.
    const first = meta.source.at - meta.source.count - history.base;
    history = withLog(history, tr, (index) => (meta.mirrors[index] === undefined ? undefined : first + meta.mirrors[index]!));
    const from = meta.kind === "undo" ? "done" : "undone";
    const to = meta.kind === "undo" ? "undone" : "done";
    const moved: HistoryEvent = { ...meta.event, at: end(history), seq: history.seq + 1 };
    return {
      ...history,
      [from]: history[from].filter((event) => event.seq !== meta.seq),
      [to]: moved.maps.length > 0 ? [...history[to], moved] : history[to],
      seq: history.seq + 1,
      prev: null,
    };
  }
  if (!tr.docChanged) return history;
  const before = history;
  history = withLog(history, tr);
  const rebased = (tr.getMeta("rebased") as number | undefined) ?? 0;
  if (rebased > 0) history = withDropped(history, tr, rebased, end(before));
  const rootMeta = appended?.getMeta(tabHistoryKey) as HistoryMeta | undefined;
  if (rootMeta) {
    // Changes appended to an undo or redo (a table fixed up) go with the event it made.
    const list = rootMeta.kind === "undo" ? "undone" : "done";
    const last = history[list][history[list].length - 1];
    if (!last) return history;
    const extended = { ...last, maps: [...last.maps, ...tr.mapping.maps], inverses: [...last.inverses, ...tr.steps.map((step, index) => step.invert(tr.docs[index]!))], at: end(history) };
    return { ...history, [list]: [...history[list].slice(0, -1), extended] };
  }
  if (tr.getMeta("addToHistory") === false || appended?.getMeta("addToHistory") === false) return history;

  const tab = timelineOf(tr);
  const maps = [...tr.mapping.maps];
  const inverses = tr.steps.map((step, index) => step.invert(tr.docs[index]!));
  const composition = tr.getMeta("composition");
  const last = history.done[history.done.length - 1];
  const prev = history.prev;
  const joins =
    prev !== null &&
    last !== undefined &&
    last.seq === prev.seq &&
    last.tab === tab &&
    last.at === end(before) &&
    (appended !== undefined ||
      (composition !== undefined && composition === prev.composition) ||
      (tr.time - prev.time < NEW_GROUP_DELAY && isAdjacent(tr, prev.ranges)));
  const ranges = appended && prev ? prev.ranges : rangesOf(maps);
  // A new change ends what could be redone in its timeline.
  const undone = history.undone.filter((event) => (tab === SHARED ? false : !inTimeline(event, tab)));
  if (joins) {
    const event = { ...last, maps: [...last.maps, ...maps], inverses: [...last.inverses, ...inverses], at: end(history) };
    return { ...history, done: [...history.done.slice(0, -1), event], undone, prev: { ...prev, time: tr.time, ranges, composition: composition ?? prev.composition } };
  }
  const event: HistoryEvent = { tab, maps, inverses, at: end(history), selection: oldState.selection.getBookmark(), seq: history.seq + 1 };
  return trimmed(
    { ...history, done: [...history.done, event], undone, seq: history.seq + 1, prev: { seq: event.seq, time: tr.time, composition, ranges } },
    tab,
  );
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    tabHistory: {
      /** Undoes the latest change of the shown tab (or a document-wide one). */
      undo: () => ReturnType;
      /** Redoes the latest undone change of the shown tab (or a document-wide one). */
      redo: () => ReturnType;
    };
  }
}

/** Undo and redo for the editor, in place of Tiptap's UndoRedo: one timeline per tab. */
export const TabHistory = Extension.create({
  name: "tabHistory",

  addCommands() {
    return {
      undo:
        () =>
        ({ state, dispatch }) =>
          undo(state, dispatch),
      redo:
        () =>
        ({ state, dispatch }) =>
          redo(state, dispatch),
    };
  },

  addKeyboardShortcuts() {
    return {
      [keyBinding("undo")]: () => this.editor.commands.undo(),
      ...Object.fromEntries(keyBindings("redo").map((key) => [key, () => this.editor.commands.redo()])),
    };
  },

  addProseMirrorPlugins() {
    return [tabHistory()];
  },
});

/** The history plugin (for tests and the editor's extension). */
export function tabHistory(): Plugin<HistoryState> {
  return new Plugin<HistoryState>({
    key: tabHistoryKey,
    state: {
      init: () => ({ done: [], undone: [], log: new Mapping(), base: 0, logLength: 0, copies: new Map(), seq: 0, prev: null }),
      apply: (tr, value, oldState) => apply(tr, value, oldState),
    },
    // Tells the collab plugin's rebasing to keep steps apart (as prosemirror-history asks).
    historyPreserveItems: true,
  } as ConstructorParameters<typeof Plugin<HistoryState>>[0]);
}
