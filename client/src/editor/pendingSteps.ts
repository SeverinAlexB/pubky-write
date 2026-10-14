// Edits not yet confirmed by the server, kept in the browser (IndexedDB) per document and editor
// session, so a closed tab, a crash or a lost connection does not lose them. The next time the
// document is opened they are rebased onto the server's newer steps and sent.
//
// Each open editor owns its entry through a Web Lock named after it, held while it is open. An
// entry whose lock is free belongs to a session that has ended and may be restored; holding its
// lock while restoring keeps two tabs from restoring it both.
import { documentSchema } from "@docs/shared";
import type { Node, Schema } from "@tiptap/pm/model";
import { Mapping, Step, Transform } from "@tiptap/pm/transform";
import { sendableSteps } from "prosemirror-collab";
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
    const request = indexedDB.open(DATABASE, 1);
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

export const pendingStore = {
  put: (entry: PendingEntry) => run("readwrite", (store) => void store.put(entry)).then(() => {}),
  remove: (key: string) => run("readwrite", (store) => void store.delete(key)).then(() => {}),
  /** Removes `key` and writes `entry` (if any) in one transaction, so the steps are never in both or neither. */
  replace: (key: string, entry: PendingEntry | null) =>
    run("readwrite", (store) => {
      store.delete(key);
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
  ) {}

  get key(): string {
    return entryKey(this.documentId, this.clientId);
  }

  /** The entry for the editor's current unconfirmed steps, or null when there are none. */
  entry(): PendingEntry | null {
    const sendable = sendableSteps(this.target.state);
    if (!sendable) return null;
    return {
      key: this.key,
      documentId: this.documentId,
      clientId: this.clientId,
      version: sendable.version,
      steps: sendable.steps.map((step) => step.toJSON()),
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
      return pendingStore.remove(this.key);
    }
    this.stored = true;
    return pendingStore.put(entry);
  }

  /** Writes `entry` in place of another session's entry (after restoring it). */
  replace(otherKey: string): Promise<void> {
    const entry = this.entry();
    this.stored = entry !== null;
    return pendingStore.replace(otherKey, entry);
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
  remaining.forEach((step, index) => {
    const mapped = step.map(mapping.slice(remaining.length - index));
    if (mapped && !transform.maybeStep(mapped).failed) {
      mapping.appendMap(mapped.getMap(), remaining.length - 1 - index);
      steps.push(mapped);
    }
  });
  return { steps, alreadySaved, dropped: remaining.length - steps.length };
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
