// A small world for the property tests: the real server (step authority and comments on an
// in-memory database), editors made of the real plugins and sync, a network that delays, fails
// and loses answers, and an in-memory stand-in for the browser's IndexedDB that outlives crashes.
import { documentSchema, type CommentThread } from "@docs/shared";
import { Node } from "@tiptap/pm/model";
import { EditorState, type Plugin, type Selection, type Transaction } from "@tiptap/pm/state";
import { SELECT_FIRST } from "./edits.ts";
import { tableEditing } from "@tiptap/pm/tables";
import { Step } from "@tiptap/pm/transform";
import { collab, getVersion, receiveTransaction, sendableSteps } from "../../client/src/editor/collab.ts";
import { CommentAnchors, type CommentAnchor } from "../../client/src/editor/commentAnchors.ts";
import { DocumentTabs } from "../../client/src/editor/documentTabs.ts";
import { tabHistory } from "../../client/src/editor/tabHistory.ts";
import { PendingPersister, restoreEntry, type PendingEntry, type PendingStore, type RestoreOutcome } from "../../client/src/editor/pendingSteps.ts";
import { getSuggesting, Suggesting, suggestTransaction, type EditorMode } from "../../client/src/editor/suggesting.ts";
import { DocumentSync, RejectedError, type CollabTarget, type StepsTransport, type SubmitResult } from "../../client/src/editor/sync.ts";
import { listComments } from "../../server/src/comments.ts";
import { openDatabase, type Database } from "../../server/src/database.ts";
import { applySteps, createDocument, endSession, getStepsSince, InvalidStepsError, openDocument } from "../../server/src/documents.ts";

const text = (value: string) => ({ type: "text", text: value });
const paragraph = (value: string) => ({ type: "paragraph", content: value ? [text(value)] : [] });

/** A document with paragraphs, a heading, a list and a table to start from. */
export const startDocument = Node.fromJSON(documentSchema, {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [text("Title")] },
    paragraph("The quick brown fox"),
    { type: "bulletList", content: [{ type: "listItem", content: [paragraph("one")] }, { type: "listItem", content: [paragraph("two")] }] },
    {
      type: "table",
      content: [
        { type: "tableRow", content: [{ type: "tableCell", content: [paragraph("a")] }, { type: "tableCell", content: [paragraph("b")] }] },
        { type: "tableRow", content: [{ type: "tableCell", content: [paragraph("c")] }, { type: "tableCell", content: [paragraph("d")] }] },
      ],
    },
    paragraph("jumps over the lazy dog"),
  ],
});

/** A seeded random number generator (mulberry32), so a failing case can be replayed. */
export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The plugins of the editor that take part in editing and saving (no view-only ones). */
export function editorPlugins(options: { version: number; clientID: string; mode: EditorMode; comments: CommentAnchor[] }): Plugin[] {
  const call = (extension: { config: { addProseMirrorPlugins?: unknown } }, extensionOptions: unknown) =>
    (extension.config.addProseMirrorPlugins as (this: unknown) => Plugin[]).call({ options: extensionOptions });
  return [
    // Tiptap orders plugins by priority: the tabs first, as in the editor.
    ...call(DocumentTabs, { initialTab: null }),
    tableEditing(),
    // The editor's undo and redo, per tab.
    tabHistory(),
    ...call(CommentAnchors, { initial: options.comments, initiallyHidden: false, onActivate: () => {} }),
    ...call(Suggesting, { initialMode: options.mode, author: "You", onActivate: () => {} }),
    collab({ version: options.version, clientID: options.clientID }),
  ];
}

/** A state with the editor's plugins, as `dispatch` applies transactions to it. */
export function editorState(doc: Node, options: Parameters<typeof editorPlugins>[0]): EditorState {
  return EditorState.create({ doc, plugins: editorPlugins(options) });
}

/**
 * Applies a transaction as the editor does: in Suggesting mode the dispatch hook rewrites it into
 * suggestions first; then the view applies it with the plugins' appended transactions.
 */
export function dispatchTo(state: EditorState, tr: Transaction, now: number): EditorState {
  const selection = tr.getMeta(SELECT_FIRST) as Selection | undefined;
  if (selection) state = state.applyTransaction(state.tr.setSelection(selection)).state;
  const suggesting = getSuggesting(state);
  let applied = tr;
  if (tr.docChanged && suggesting.mode === "suggesting") {
    applied = suggestTransaction(state, tr, { author: "You", now, group: suggesting.group })?.tr ?? tr;
  }
  return state.applyTransaction(applied).state;
}

/** The browser's store of unsaved edits: it survives a crash; writes land in the order they are made. */
export class MemoryStore implements PendingStore {
  readonly entries = new Map<string, PendingEntry>();
  async put(entry: PendingEntry) {
    this.entries.set(entry.key, structuredClone(entry));
  }
  async remove(key: string) {
    this.entries.delete(key);
  }
  async replace(keys: readonly string[], entry: PendingEntry | null) {
    for (const key of keys) this.entries.delete(key);
    if (entry) this.entries.set(entry.key, structuredClone(entry));
  }
  async list(documentId: string) {
    return [...this.entries.values()].filter((entry) => entry.documentId === documentId).map((entry) => structuredClone(entry));
  }
}

export type NetworkOptions = {
  /** Chance that a request fails before it reaches the server. */
  failure: number;
  /** Chance that the server applies a batch but its answer is lost. */
  lostAnswer: number;
  /** Longest delay of a request and of its answer, in milliseconds. */
  maxDelayMs: number;
};

export const reliable: NetworkOptions = { failure: 0, lostAnswer: 0, maxDelayMs: 0 };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class World {
  readonly db: Database = openDatabase(":memory:");
  readonly documentId: string;
  readonly initial: Node;
  readonly store = new MemoryStore();
  readonly clients: Client[] = [];
  network: NetworkOptions = reliable;
  offline = false;
  private sessions = 0;

  constructor(
    doc: Node,
    readonly rand: () => number,
  ) {
    this.initial = doc;
    this.documentId = createDocument(this.db, "Property", 0, doc).id;
  }

  /** The server's document and version, as GET /api/documents/:id returns it. */
  opened() {
    const opened = openDocument(this.db, this.documentId)!;
    return { doc: Node.fromJSON(documentSchema, opened.content), version: opened.version, comments: opened.comments };
  }

  serverDoc(): Node {
    return this.opened().doc;
  }

  comments(): CommentThread[] {
    return listComments(this.db, this.documentId);
  }

  /** Opens the document in a new editor session (a new tab or a reload). */
  open(mode: EditorMode = "editing"): Client {
    const client = new Client(this, `session-${++this.sessions}`, mode);
    this.clients.push(client);
    return client;
  }

  /** A request over the network: delayed, failing or answering as `network` says. */
  async request<T>(send: () => T, losable: boolean): Promise<T> {
    const { failure, lostAnswer, maxDelayMs } = this.network;
    if (maxDelayMs > 0) await sleep(Math.floor(this.rand() * maxDelayMs));
    if (this.offline || this.rand() < failure) throw new Error("Network failure");
    const result = send();
    if (maxDelayMs > 0) await sleep(Math.floor(this.rand() * maxDelayMs));
    if (losable && (this.offline || this.rand() < lostAnswer)) throw new Error("Answer lost");
    return result;
  }

  transport(): StepsTransport {
    return {
      submit: (request) =>
        this.request((): SubmitResult => {
          let result;
          try {
            result = applySteps(this.db, this.documentId, request);
          } catch (error) {
            if (error instanceof InvalidStepsError) throw new RejectedError(error.message);
            throw error;
          }
          if (!result) throw new RejectedError("Document not found");
          return result.kind === "applied"
            ? { kind: "accepted", version: result.version, alreadyApplied: result.alreadyApplied }
            : { kind: "conflict", version: result.version, steps: result.steps, clientIds: result.clientIds };
        }, true),
    };
  }
}

export class Client {
  state: EditorState;
  /** What the sync and the store see of the editor (a view, in the app). */
  readonly target: CollabTarget;
  readonly sync: DocumentSync;
  readonly persister: PendingPersister;
  crashed = false;
  /** Rejected batches (the editor asks to reload). */
  rejected = false;

  constructor(
    readonly world: World,
    readonly clientId: string,
    mode: EditorMode,
  ) {
    const opened = world.opened();
    const comments = opened.comments.map(({ id, from, to, resolved }) => ({ id, from, to, resolved }));
    this.state = editorState(opened.doc, { version: opened.version, clientID: clientId, mode, comments });
    const client = this;
    this.target = {
      get state() {
        return client.state;
      },
      dispatch: (tr: Transaction) => client.apply(tr),
    };
    this.persister = new PendingPersister(world.documentId, clientId, this.target, world.store);
    this.sync = new DocumentSync(this.target, world.transport(), {
      debounceMs: 300,
      initialRetryMs: 200,
      maxRetryMs: 2000,
      persist: () => this.persister.save(),
      onStatusChange: (status) => {
        if (status === "error") this.rejected = true;
      },
    });
  }

  /** The editor's dispatch: the suggestion rewriting, the plugins, then the sync and the store hear of the change. */
  dispatch(tr: Transaction): void {
    if (this.crashed) return;
    this.apply(tr);
  }

  private apply(tr: Transaction): void {
    const before = this.state.doc;
    this.state = dispatchTo(this.state, tr, Date.now());
    if (this.state.doc !== before) {
      this.sync.notifyChange();
      this.persister.schedule();
    }
  }

  get version(): number {
    return getVersion(this.state);
  }

  get unsaved(): boolean {
    return sendableSteps(this.state) !== null;
  }

  /** The tab closes or the browser crashes: whatever is in flight still reaches the server. */
  crash(): void {
    this.crashed = true;
    this.sync.destroy();
    this.persister.destroy();
  }

  /** Restores the entries other sessions left in the store, as the editor does when it opens. */
  async restore(): Promise<RestoreOutcome[]> {
    const outcomes: RestoreOutcome[] = [];
    const entries = (await this.world.store.list(this.world.documentId))
      .filter((entry) => entry.clientId !== this.clientId && this.world.clients.find((client) => client.clientId === entry.clientId)?.crashed !== false)
      .sort((a, b) => a.savedAt - b.savedAt);
    for (const entry of entries) {
      const outcome = await this.sync.exclusive(() =>
        restoreEntry(this.target, entry, {
          endSession: (clientId, version) => this.world.request(() => endSession(this.world.db, this.world.documentId, clientId, version)!, false),
          refused: (error) => error instanceof InvalidStepsError,
          replaceEntry: (key) => this.persister.replace(key),
        }),
      );
      outcomes.push(outcome);
      if (outcome === "offline") break;
    }
    return outcomes;
  }

  /** Receives the server's steps it has not seen (another client's edits reach it only on a conflict otherwise). */
  catchUp(): void {
    const since = getStepsSince(this.world.db, this.world.documentId, this.version)!;
    if (since.steps.length === 0) return;
    const steps = since.steps.map((json) => Step.fromJSON(documentSchema, json));
    this.apply(receiveTransaction(this.state, steps, since.clientIds, { mapSelectionBackward: true }));
  }
}
