// Edits not yet confirmed by the server, kept in the browser (IndexedDB) per document and editor
// session, so a closed tab, a crash or a lost connection does not lose them. The next time the
// document is opened they are rebased onto the server's newer steps and sent.
//
// Each open editor owns its entry through a Web Lock named after it, held while it is open. An
// entry whose lock is free belongs to a session that has ended and may be restored; holding its
// lock while restoring keeps two tabs from restoring it both.
import { documentSchema } from "@pubky-write/shared";
import type { Node, Schema } from "@tiptap/pm/model";
import { Mapping, ReplaceStep, Step, Transform } from "@tiptap/pm/transform";
import { exactInverse, getVersion, HISTORY_STEPS, receiveTransaction, sendableSteps, unconfirmedSteps } from "./collab.ts";
import { flushPendingSelection } from "./pendingSelection.ts";
import type { CollabTarget } from "./sync.ts";

export type PendingEntry = {
  /** `<documentId>:<clientId>` */
  key: string;
  documentId: string;
  /** The editor session (collab client id) whose steps these are. */
  clientId: string;
  /** The server version the steps are built on. */
  version: number;
  steps: unknown[];
  /** Each step's exact inverse and whether it was an undo or redo (entries saved before these existed have neither). */
  inverses?: unknown[];
  undos?: boolean[];
  /** The document's text when last saved here, for downloading if the edits cannot be restored. */
  text: string;
  savedAt: number;
};

const DATABASE = "docs-offline";
const STORE = "pendingSteps";

let database: Promise<IDBDatabase | null> | null = null;

function openDatabase(): Promise<IDBDatabase | null> {
  database ??= new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DATABASE, 1);
    } catch {
      // Some private browsing modes throw instead of failing the request.
      return resolve(null);
    }
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: "key" }).createIndex("documentId", "documentId");
    };
    request.onsuccess = () => resolve(request.result);
    // Private windows and blocked storage: edits are then only kept in memory, as before.
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return database;
}

/** Runs one request in a transaction of its own; transactions on the store run in the order they are made. */
async function run<T>(mode: IDBTransactionMode, use: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDatabase();
  if (!db) return undefined;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = use(transaction.objectStore(STORE));
    transaction.oncomplete = () => resolve(request ? request.result : undefined);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/** Where entries are kept: IndexedDB in the browser (`pendingStore`), anything with the same order guarantees in tests. */
export type PendingStore = {
  put(entry: PendingEntry): Promise<void>;
  remove(key: string): Promise<void>;
  /** Removes the entries `keys` and writes `entry` (if any) in one transaction. */
  replace(keys: readonly string[], entry: PendingEntry | null): Promise<void>;
  list(documentId: string): Promise<PendingEntry[]>;
};

export const pendingStore: PendingStore = {
  put: (entry: PendingEntry) => run("readwrite", (store) => void store.put(entry)).then(() => {}),
  remove: (key: string) => run("readwrite", (store) => void store.delete(key)).then(() => {}),
  /** Removes `keys` and writes `entry` (if any) in one transaction, so the steps are never in both or neither. */
  replace: (keys: readonly string[], entry: PendingEntry | null) =>
    run("readwrite", (store) => {
      for (const key of keys) store.delete(key);
      if (entry) store.put(entry);
    }).then(() => {}),
  list: async (documentId: string): Promise<PendingEntry[]> =>
    ((await run("readonly", (store) => store.index("documentId").getAll(documentId))) as PendingEntry[] | undefined) ?? [],
};

export const entryKey = (documentId: string, clientId: string) => `${documentId}:${clientId}`;
const lockName = (key: string) => `docs-pending:${key}`;

/** Marks this editor session's entry as owned while the editor is open; returns the release. */
export function holdEntry(documentId: string, clientId: string): () => void {
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  void navigator.locks?.request(lockName(entryKey(documentId, clientId)), () => held);
  return release;
}

/** Runs `task` holding the entry's lock if no open editor owns it; resolves to null when one does. */
export async function claimEntry<T>(entry: PendingEntry, task: () => Promise<T>): Promise<T | null> {
  if (!navigator.locks) return task();
  return navigator.locks.request(lockName(entry.key), { ifAvailable: true }, (lock) => (lock ? task() : null));
}

/**
 * Keeps an editor's unconfirmed steps in the store. `save` runs before every batch the sync sends
 * (see sync.ts); `schedule` saves once typing pauses, with the document's text.
 */
export class PendingPersister {
  private text = "";
  private stored = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly documentId: string,
    private readonly clientId: string,
    private readonly target: CollabTarget,
    private readonly store: PendingStore = pendingStore,
  ) {}

  get key(): string {
    return entryKey(this.documentId, this.clientId);
  }

  /** The entry for the editor's current unconfirmed steps, or null when there are none. */
  entry(): PendingEntry | null {
    const sendable = sendableSteps(this.target.state);
    if (!sendable) return null;
    const unconfirmed = unconfirmedSteps(this.target.state);
    return {
      key: this.key,
      documentId: this.documentId,
      clientId: this.clientId,
      version: sendable.version,
      steps: sendable.steps.map((step) => step.toJSON()),
      inverses: unconfirmed.map(({ inverted }) => inverted.toJSON()),
      undos: unconfirmed.map(({ history }) => history),
      text: this.text,
      savedAt: Date.now(),
    };
  }

  /** Writes the current state now. The entry is read synchronously, so writes land in order. */
  save(): Promise<void> {
    const entry = this.entry();
    if (!entry) {
      if (!this.stored) return Promise.resolve();
      this.stored = false;
      return this.store.remove(this.key);
    }
    this.stored = true;
    return this.store.put(entry);
  }

  /**
   * Writes this session's entry in place of another session's (after restoring it). With nothing
   * unsaved left, this session's own earlier entry goes too: otherwise it would stay behind once
   * `stored` says there is none, and be restored again by the next session.
   */
  replace(otherKey: string): Promise<void> {
    const entry = this.entry();
    const keys = entry === null && this.stored ? [otherKey, this.key] : [otherKey];
    this.stored = entry !== null;
    return this.store.replace(keys, entry);
  }

  /** After a local change: once typing pauses, saves the steps that are still unconfirmed, with the text. */
  schedule(delayMs = 1000): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (!sendableSteps(this.target.state)) return void this.save();
      const { doc } = this.target.state;
      this.text = doc.textBetween(0, doc.content.size, "\n", " ");
      void this.save();
    }, delayMs);
  }

  destroy(): void {
    clearTimeout(this.timer);
  }
}

export type RebaseResult = {
  /** The pending steps that were not on the server yet, mapped onto `doc`. */
  steps: Step[];
  /** For each of `steps`, whether it was made by undo or redo. */
  undos: boolean[];
  /** Pending steps the server had already applied (sent just before the session ended). */
  alreadySaved: number;
  /** Pending steps that no longer apply. */
  dropped: number;
};

/**
 * Rebases an earlier session's pending steps onto the editor's document. `server` are the server's
 * steps after the entry's version (up to the editor's version) with their clients; `local` are
 * the editor's own unconfirmed steps, which `doc` includes. The server steps that start the list
 * and come from the entry's client are its own first steps, applied before the session ended, so
 * they are skipped instead of being applied twice.
 */
export function rebasePending(
  doc: Node,
  pending: readonly Step[],
  pendingClientId: string,
  server: { steps: readonly Step[]; clientIds: readonly string[] },
  local: readonly Step[],
  /** The pending steps' exact inverses and which were undo or redo, when the entry has them. */
  history?: { inverses: readonly Step[]; undos: readonly boolean[] },
): RebaseResult {
  let alreadySaved = 0;
  while (alreadySaved < pending.length && alreadySaved < server.clientIds.length && server.clientIds[alreadySaved] === pendingClientId) {
    alreadySaved++;
  }
  const remaining = pending.slice(alreadySaved);
  const over = [...server.steps.slice(alreadySaved), ...local];
  // As prosemirror-collab rebases: undo the pending steps, apply the others, then redo each
  // pending step mapped through all of that (mirrored maps cancel out where a step was redone).
  const mapping = new Mapping();
  for (let index = remaining.length - 1; index >= 0; index--) mapping.appendMap(remaining[index]!.getMap().invert());
  for (const step of over) mapping.appendMap(step.getMap());
  const transform = new Transform(doc);
  const steps: Step[] = [];
  const inverses = history?.inverses.slice(alreadySaved);
  const undos = history?.undos.slice(alreadySaved);
  // Without the inverses (an older entry), undo steps are recognised by their shape.
  const undoing = inverses ? new Map<number, number>() : inversePairs(remaining);
  const dropped = new Set<number>();
  // As the collab plugin does (collab.ts, rebaseSteps): an undo or redo is redone as the exact
  // inverse of what the step it undoes became, or dropped with it.
  const json = (step: Step) => JSON.stringify(step.toJSON());
  const done: { inverted: string; applied: { mapIndex: number; inverse: Step } | null }[] = [];
  const kept: boolean[] = [];
  remaining.forEach((step, index) => {
    const undone = undoing.get(index);
    const undoes = undos?.[index] ? done.findLast((record) => record.inverted === json(step)) : undefined;
    const mapped =
      undone !== undefined && dropped.has(undone)
        ? null
        : undoes
          ? undoes.applied && undoes.applied.inverse.map(mapping.slice(undoes.applied.mapIndex + 1))
          : step.map(mapping.slice(remaining.length - index));
    const before = transform.doc;
    if (mapped && !transform.maybeStep(mapped).failed) {
      mapping.appendMap(mapped.getMap(), undoes ? undefined : remaining.length - 1 - index);
      steps.push(mapped);
      kept.push(undos?.[index] === true);
      if (inverses) done.push({ inverted: json(inverses[index]!), applied: { mapIndex: mapping.maps.length - 1, inverse: exactInverse(mapped, before) } });
    } else {
      dropped.add(index);
      if (inverses) done.push({ inverted: json(inverses[index]!), applied: null });
    }
  });
  return { steps, undos: kept, alreadySaved, dropped: remaining.length - steps.length };
}

/**
 * The steps that undo an earlier one (by index, to the index of the step they undo): a replacement
 * of exactly the range the earlier step produced, by as much as it took out, once the steps
 * between are mapped over (with the pairs among them cancelling out). If the earlier step no longer
 * applies when the steps are rebased, its undo must not apply either: it would insert the text a
 * second time.
 */
function inversePairs(pending: readonly Step[]): Map<number, number> {
  const pairs = new Map<number, number>();
  const paired = new Set<number>();
  pending.forEach((step, index) => {
    if (!(step instanceof ReplaceStep)) return;
    for (let earlier = index - 1; earlier >= 0; earlier--) {
      const original = pending[earlier]!;
      if (paired.has(earlier) || !(original instanceof ReplaceStep)) continue;
      const between = new Mapping();
      for (let other = earlier + 1; other < index; other++) {
        const undone = pairs.get(other);
        between.appendMap(pending[other]!.getMap(), undone !== undefined && undone > earlier ? undone - earlier - 1 : undefined);
      }
      const from = between.map(original.from, -1);
      const to = between.map(original.from + original.slice.size, 1);
      if (step.from === from && step.to === to && step.slice.size === original.to - original.from) {
        pairs.set(index, earlier);
        paired.add(earlier);
        return;
      }
    }
  });
  return pairs;
}

export type RestoreOutcome = "restored" | "nothing" | "partial" | "failed" | "offline";

export type RestoreOptions = {
  /**
   * Ends the entry's session on the server, so a batch it sent just before it closed is either
   * among the returned steps or refused, never applied after them; the server's steps after
   * `version`, with their clients (POST /api/documents/:id/sessions/:clientId/end).
   */
  endSession(clientId: string, version: number): Promise<{ steps: unknown[]; clientIds: string[] }>;
  /** Whether a failed request means the server refused it (the entry cannot be restored) rather than no connection. */
  refused(error: unknown): boolean;
  /** Makes the restored steps this session's entry in place of the restored one (`PendingPersister.replace`). */
  replaceEntry(key: string): Promise<void>;
};

/**
 * Restores an entry kept by an earlier session into `target` (an editor whose sync is paused, see
 * DocumentSync.exclusive): catches the editor up with the server, rebases the entry's steps (see
 * rebasePending) and applies them as raw steps, which the sync then sends.
 */
export async function restoreEntry(target: CollabTarget, entry: PendingEntry, options: RestoreOptions): Promise<RestoreOutcome> {
  const { schema } = target.state;
  const pending = parseSteps(entry.steps, schema);
  if (!pending) return "failed";
  const editorVersion = getVersion(target.state);
  const since = Math.min(entry.version, editorVersion);
  let server;
  try {
    server = await options.endSession(entry.clientId, since);
  } catch (error) {
    return options.refused(error) ? "failed" : "offline";
  }
  const steps = parseSteps(server.steps, target.state.schema);
  if (!steps) return "failed";
  // Catch up with the server first (the entry may be newer than what this editor loaded).
  const fromEditor = editorVersion - since;
  if (steps.length > fromEditor) {
    flushPendingSelection(target);
    target.dispatch(receiveTransaction(target.state, steps.slice(fromEditor), server.clientIds.slice(fromEditor), { mapSelectionBackward: true }));
  }
  const fromEntry = entry.version - since;
  const inverses = entry.inverses && entry.undos?.length === pending.length ? parseSteps(entry.inverses, schema) : null;
  const result = rebasePending(
    target.state.doc,
    pending,
    entry.clientId,
    { steps: steps.slice(fromEntry), clientIds: server.clientIds.slice(fromEntry) },
    sendableSteps(target.state)?.steps ?? [],
    inverses && inverses.length === pending.length ? { inverses, undos: entry.undos! } : undefined,
  );
  if (result.steps.length > 0) {
    const tr = target.state.tr;
    for (const step of result.steps) tr.step(step);
    // Raw steps: not an undo step, and not rewritten into suggestions again. The collab plugin
    // keeps which were undo or redo, for its next rebase.
    target.dispatch(tr.setMeta("addToHistory", false).setMeta(HISTORY_STEPS, result.undos));
  }
  // The restored steps are this session's unsaved steps now; the old entry goes in the same write.
  await options.replaceEntry(entry.key).catch(() => {});
  if (result.dropped > 0) return "partial";
  return result.steps.length > 0 ? "restored" : "nothing";
}

/**
 * Parses stored steps with the editor's schema (steps only apply to documents of the schema they
 * were read with); null if any does not fit it (for example after an update).
 */
export function parseSteps(json: readonly unknown[], schema: Schema = documentSchema): Step[] | null {
  try {
    return json.map((step) => Step.fromJSON(schema, step));
  } catch {
    return null;
  }
}

/** The text an entry would add, for when its document's text was never saved with it. */
export function entryText(entry: PendingEntry): string {
  if (entry.text) return entry.text;
  return entry.steps.map((json) => textOfJSON((json as { slice?: { content?: unknown } }).slice?.content)).join("");
}

function textOfJSON(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((node) => {
      const value = node as { type?: string; text?: string; content?: unknown };
      if (typeof value.text === "string") return value.text;
      const inner = textOfJSON(value.content);
      return value.type === "paragraph" || value.type === "heading" ? `${inner}\n` : inner;
    })
    .join("");
}
