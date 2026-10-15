// The editor's collaboration plugin: prosemirror-collab 1.3.1 (MIT, © Marijn Haverbeke and
// others, https://github.com/ProseMirror/prosemirror-collab) with two changes to how the editor's
// unconfirmed steps are rebased over the server's, found by the property tests in tests/property:
//
// 1. Every unconfirmed step keeps an exact inverse. ProseMirror inverts a mark step by removing
//    (or adding) the mark over its whole range, which is exact for the steps a transform makes but
//    not for a step rebased over text that has the mark already: undoing it while rebasing again
//    removed the other session's formatting, and if the step was then dropped the editor kept
//    showing text without formatting the server had.
// 2. When a step no longer applies after rebasing (a deletion that now starts inside a list another
//    session made) and is dropped, the undo and redo steps after it are dropped too. The library
//    kept them: an undo of the dropped deletion then inserted its text a second time.
//
// The rest (versions, client ids, sendable steps, the transaction metadata the history plugin
// reads) is unchanged, so the history, the sync and the server see the same plugin.
import { Mark, type Node, type Schema } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import {
  AddMarkStep,
  RemoveMarkStep,
  Step,
  StepMap,
  StepResult,
  Transform,
  type Mappable,
} from "@tiptap/pm/transform";

class Rebaseable {
  constructor(
    readonly step: Step,
    readonly inverted: Step,
    readonly origin: Transform,
  ) {}
}

/** Sets the marks of the inline content of a range back to what they were: the exact inverse of a mark step. */
export class RestoreMarksStep extends Step {
  constructor(
    readonly from: number,
    readonly to: number,
    /** Ranges of inline content with their marks, in order, covering the inline content of `from`–`to`. */
    readonly ranges: readonly { from: number; to: number; marks: readonly Mark[] }[],
  ) {
    super();
  }

  /** The marks of the range in `doc`. */
  static of(doc: Node, from: number, to: number): RestoreMarksStep {
    const ranges: { from: number; to: number; marks: readonly Mark[] }[] = [];
    doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isInline) return true;
      ranges.push({ from: Math.max(pos, from), to: Math.min(pos + node.nodeSize, to), marks: node.marks });
      return false;
    });
    return new RestoreMarksStep(from, to, ranges);
  }

  apply(doc: Node): StepResult {
    const transform = new Transform(doc);
    try {
      for (const range of this.ranges) {
        transform.removeMark(range.from, range.to);
        for (const mark of range.marks) transform.addMark(range.from, range.to, mark);
      }
    } catch (error) {
      return StepResult.fail((error as Error).message);
    }
    return StepResult.ok(transform.doc);
  }

  getMap(): StepMap {
    return StepMap.empty;
  }

  invert(doc: Node): Step {
    return RestoreMarksStep.of(doc, this.from, this.to);
  }

  map(mapping: Mappable): Step | null {
    const from = mapping.mapResult(this.from, 1);
    const to = mapping.mapResult(this.to, -1);
    if ((from.deleted && to.deleted) || from.pos >= to.pos) return null;
    const ranges = this.ranges.flatMap((range) => {
      const start = mapping.map(range.from, 1);
      const end = mapping.map(range.to, -1);
      return start < end ? [{ from: start, to: end, marks: range.marks }] : [];
    });
    return new RestoreMarksStep(from.pos, to.pos, ranges);
  }

  toJSON() {
    return {
      stepType: "restoreMarks",
      from: this.from,
      to: this.to,
      ranges: this.ranges.map((range) => ({ from: range.from, to: range.to, marks: range.marks.map((mark) => mark.toJSON()) })),
    };
  }

  static fromJSON(schema: Schema, json: { from: number; to: number; ranges: { from: number; to: number; marks: unknown[] }[] }): RestoreMarksStep {
    return new RestoreMarksStep(
      json.from,
      json.to,
      json.ranges.map((range) => ({ from: range.from, to: range.to, marks: range.marks.map((mark) => Mark.fromJSON(schema, mark)) })),
    );
  }
}

// Only ever made in the editor (inverses are never sent), registered so it reads back from JSON.
Step.jsonID("restoreMarks", RestoreMarksStep);

/** `step`'s inverse in `doc` (the document before it), exact also for mark steps over partly marked text. */
export function exactInverse(step: Step, doc: Node): Step {
  const inverted = step.invert(doc);
  if (!(step instanceof AddMarkStep || step instanceof RemoveMarkStep)) return inverted;
  const after = step.apply(doc).doc;
  const restored = after && inverted.apply(after).doc;
  if (restored && restored.slice(step.from, step.to).eq(doc.slice(step.from, step.to))) return inverted;
  return RestoreMarksStep.of(doc, step.from, step.to);
}

/**
 * Undoes `steps`, applies `over`, and redoes `steps` mapped over them. A step that no longer
 * applies is dropped, and with it the undo and redo steps after it: they may be the undo of that
 * very step, which would otherwise insert its text a second time.
 */
export function rebaseSteps(steps: readonly Rebaseable[], over: readonly Step[], transform: Transform): Rebaseable[] {
  for (let index = steps.length - 1; index >= 0; index--) transform.step(steps[index]!.inverted);
  for (const step of over) transform.step(step);
  const result: Rebaseable[] = [];
  let dropped = false;
  for (let index = 0, mapFrom = steps.length; index < steps.length; index++) {
    const original = steps[index]!;
    const mapped = dropped && isHistoryStep(original) ? null : original.step.map(transform.mapping.slice(mapFrom));
    mapFrom--;
    const before = transform.doc;
    if (mapped && !transform.maybeStep(mapped).failed) {
      // The redone step mirrors its inverse, so positions in content it deleted map back (internal API, as in the library).
      (transform.mapping as unknown as { setMirror(n: number, m: number): void }).setMirror(mapFrom, transform.steps.length - 1);
      result.push(new Rebaseable(mapped, exactInverse(mapped, before), original.origin));
    } else {
      dropped = true;
    }
  }
  return result;
}

/** A step made by undo or redo. */
function isHistoryStep(rebaseable: Rebaseable): boolean {
  return (rebaseable.origin as Transaction).getMeta?.("history$") !== undefined;
}

class CollabState {
  constructor(
    /** The version of the last steps received from the server. */
    readonly version: number,
    /** The local steps the server has not confirmed yet. */
    readonly unconfirmed: readonly Rebaseable[],
  ) {}
}

function unconfirmedFrom(transform: Transform): Rebaseable[] {
  return transform.steps.map((step, index) => new Rebaseable(step, exactInverse(step, transform.docs[index]!), transform));
}

export const collabKey = new PluginKey<CollabState>("collab");

type CollabConfig = { version: number; clientID: number | string };

/** The collaboration plugin: tracks the confirmed version and the unconfirmed steps. */
export function collab(config: { version?: number; clientID?: number | string } = {}): Plugin {
  const conf: CollabConfig = {
    version: config.version || 0,
    clientID: config.clientID == null ? Math.floor(Math.random() * 0xffffffff) : config.clientID,
  };
  return new Plugin<CollabState>({
    key: collabKey,
    state: {
      init: () => new CollabState(conf.version, []),
      apply(tr, collab) {
        const newState = tr.getMeta(collabKey) as CollabState | undefined;
        if (newState) return newState;
        if (tr.docChanged) return new CollabState(collab.version, collab.unconfirmed.concat(unconfirmedFrom(tr)));
        return collab;
      },
    },
    config: conf,
    // Tells the history not to merge steps, so that it can be rebased.
    historyPreserveItems: true,
  } as ConstructorParameters<typeof Plugin<CollabState>>[0]);
}

const configOf = (state: EditorState) => (collabKey.get(state)!.spec as unknown as { config: CollabConfig }).config;

/**
 * The transaction that applies steps received from the server: the editor's own steps among the
 * first ones are confirmed, the remaining unconfirmed steps are rebased over the others.
 */
export function receiveTransaction(
  state: EditorState,
  steps: readonly Step[],
  clientIDs: readonly (string | number)[],
  options: { mapSelectionBackward?: boolean } = {},
): Transaction {
  const collabState = collabKey.getState(state)!;
  const version = collabState.version + steps.length;
  const ourID = configOf(state).clientID;
  // The steps that start the list and came from this editor.
  let ours = 0;
  // Loose equality, as the library: the server sends client ids as strings.
  // eslint-disable-next-line eqeqeq
  while (ours < clientIDs.length && clientIDs[ours] == ourID) ++ours;
  let unconfirmed = collabState.unconfirmed.slice(ours);
  const others = ours ? steps.slice(ours) : steps;
  if (!others.length) return state.tr.setMeta(collabKey, new CollabState(version, unconfirmed));
  const nUnconfirmed = unconfirmed.length;
  const tr = state.tr;
  if (nUnconfirmed) {
    unconfirmed = rebaseSteps(unconfirmed, others, tr);
  } else {
    for (const step of others) tr.step(step);
    unconfirmed = [];
  }
  const newCollabState = new CollabState(version, unconfirmed);
  if (options.mapSelectionBackward && state.selection instanceof TextSelection) {
    tr.setSelection(
      TextSelection.between(tr.doc.resolve(tr.mapping.map(state.selection.anchor, -1)), tr.doc.resolve(tr.mapping.map(state.selection.head, -1)), -1),
    );
    (tr as unknown as { updated: number }).updated &= ~1;
  }
  return tr.setMeta("rebased", nUnconfirmed).setMeta("addToHistory", false).setMeta(collabKey, newCollabState);
}

/** The unconfirmed steps to send, or null when there are none. */
export function sendableSteps(state: EditorState): { version: number; steps: Step[]; clientID: number | string; origins: Transform[] } | null {
  const collabState = collabKey.getState(state)!;
  if (collabState.unconfirmed.length === 0) return null;
  return {
    version: collabState.version,
    steps: collabState.unconfirmed.map((rebaseable) => rebaseable.step),
    clientID: configOf(state).clientID,
    get origins() {
      return collabState.unconfirmed.map((rebaseable) => rebaseable.origin);
    },
  };
}

/** The version up to which the editor has the server's steps. */
export function getVersion(state: EditorState): number {
  return collabKey.getState(state)!.version;
}
