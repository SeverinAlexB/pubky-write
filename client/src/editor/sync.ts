// Sends local edits to the server as batches of ProseMirror steps, modelled on how the reference product saves:
// edits are debounced into batches, only one batch is in flight at a time, and each batch is stamped
// with the version it was built on. If the server has moved on, it answers with the steps this client
// is missing; prosemirror-collab rebases the local steps on top of them and they are sent again.
//
// Before each batch is sent, the unconfirmed steps are kept in the browser (`persist`, see
// pendingSteps.ts), so they survive a closed tab or a crash. The kept version is always the one
// the batch is built on, so after a crash the server's steps from that version show which of the
// kept steps it had already applied (they carry this client's id) and none is applied twice.
import type { SubmitStepsRequest } from "@docs/shared";
import { receiveTransaction, sendableSteps } from "./collab.ts";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { Step } from "@tiptap/pm/transform";
import { flushPendingSelection } from "./pendingSelection.ts";

export type SaveStatus = "saved" | "saving" | "offline" | "error";

export type SubmitResult =
  | { kind: "accepted"; version: number; alreadyApplied?: boolean }
  | { kind: "conflict"; version: number; steps: unknown[]; clientIds: string[] };

export interface StepsTransport {
  /** Throws `RejectedError` when the server refuses the batch; any other error is treated as a network failure. */
  submit(request: SubmitStepsRequest): Promise<SubmitResult>;
}

/** The part of an editor view the sync needs; satisfied by ProseMirror's `EditorView`. */
export interface CollabTarget {
  readonly state: EditorState;
  dispatch(transaction: Transaction): void;
}

/** The server refused the batch (for example because a step was invalid). Retrying will not help. */
export class RejectedError extends Error {}

export type SyncOptions = {
  debounceMs?: number;
  initialRetryMs?: number;
  maxRetryMs?: number;
  onStatusChange?: (status: SaveStatus) => void;
  /** Keeps the unconfirmed steps in the browser; awaited before every batch. */
  persist?: () => Promise<void>;
};

export class DocumentSync {
  private status: SaveStatus = "saved";
  private inFlight = false;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retryMs: number;
  private destroyed = false;
  private idleWaiters: (() => void)[] = [];
  /** While above 0 (see `exclusive`), nothing is sent. */
  private paused = 0;

  private readonly debounceMs: number;
  private readonly initialRetryMs: number;
  private readonly maxRetryMs: number;
  private readonly onStatusChange: (status: SaveStatus) => void;
  private readonly persist: () => Promise<void>;

  constructor(
    private readonly target: CollabTarget,
    private readonly transport: StepsTransport,
    options: SyncOptions = {},
  ) {
    this.debounceMs = options.debounceMs ?? 300;
    this.initialRetryMs = options.initialRetryMs ?? 1000;
    this.maxRetryMs = options.maxRetryMs ?? 30_000;
    this.retryMs = this.initialRetryMs;
    this.onStatusChange = options.onStatusChange ?? (() => {});
    this.persist = options.persist ?? (async () => {});
  }

  get saveStatus(): SaveStatus {
    return this.status;
  }

  get hasUnsavedChanges(): boolean {
    return this.inFlight || sendableSteps(this.target.state) !== null;
  }

  /** Call after every local change; the batch is sent once typing pauses for `debounceMs`. */
  notifyChange(): void {
    if (this.destroyed || this.status === "error") return;
    if (sendableSteps(this.target.state) && this.status === "saved") this.setStatus("saving");
    clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => void this.flush(), this.debounceMs);
  }

  /** Sends everything now and resolves once all local changes are saved (or saving fails). */
  async flushNow(): Promise<void> {
    clearTimeout(this.flushTimer);
    clearTimeout(this.retryTimer);
    const idle = new Promise<void>((resolve) => this.idleWaiters.push(resolve));
    void this.flush();
    return idle;
  }

  /** The browser lost its connection: show it, even with nothing to save. */
  connectionLost(): void {
    if (this.destroyed || this.status === "error") return;
    this.setStatus("offline");
  }

  /** The connection is back: send now instead of waiting for the next retry. */
  connectionRestored(): void {
    if (this.destroyed || this.status === "error") return;
    clearTimeout(this.retryTimer);
    this.retryMs = this.initialRetryMs;
    void this.flush();
  }

  /**
   * Runs `task` with nothing in flight and nothing sent meanwhile, so the editor's version does
   * not change under it (restoring edits kept from an earlier session). Sending resumes after it.
   */
  async exclusive<T>(task: () => Promise<T>): Promise<T> {
    this.paused++;
    try {
      while (this.inFlight) await new Promise((resolve) => setTimeout(resolve, 20));
      return await task();
    } finally {
      this.paused--;
      if (this.paused === 0) void this.flush();
    }
  }

  destroy(): void {
    this.destroyed = true;
    clearTimeout(this.flushTimer);
    clearTimeout(this.retryTimer);
    this.resolveIdleWaiters();
  }

  private async flush(): Promise<void> {
    if (this.destroyed || this.inFlight || this.status === "error" || this.paused > 0) return;
    this.inFlight = true;
    // Kept in the browser first, at the version the batch is built on (see the top of this file).
    await this.persist().catch(() => {});
    const sendable = sendableSteps(this.target.state);
    if (!sendable || this.destroyed) {
      this.inFlight = false;
      // Nothing to save; while the browser reports no connection the indicator stays offline.
      if (!this.destroyed && (this.status !== "offline" || browserOnline())) this.setStatus("saved");
      this.resolveIdleWaiters();
      return;
    }

    this.setStatus("saving");
    let result: SubmitResult;
    try {
      result = await this.transport.submit({
        clientId: String(sendable.clientID),
        version: sendable.version,
        steps: sendable.steps.map((step) => step.toJSON()),
      });
    } catch (error) {
      this.inFlight = false;
      if (this.destroyed) return;
      if (error instanceof RejectedError) {
        this.setStatus("error");
      } else {
        this.setStatus("offline");
        this.scheduleRetry();
      }
      this.resolveIdleWaiters();
      return;
    }

    this.inFlight = false;
    if (this.destroyed) return;
    this.retryMs = this.initialRetryMs;

    if (result.kind === "accepted") {
      this.receive(sendable.steps, sendable.steps.map(() => sendable.clientID));
    } else {
      this.receive(
        // The editor's own schema: steps apply only to documents of the schema they were read with.
        result.steps.map((json) => Step.fromJSON(this.target.state.schema, json)),
        result.clientIds,
      );
    }
    // Edits made while the request was in flight, or steps rebased after a conflict, go next.
    void this.flush();
  }

  private receive(steps: readonly Step[], clientIds: readonly (string | number)[]): void {
    // The confirmation can arrive in the middle of a keyboard selection: read the browser's first.
    flushPendingSelection(this.target);
    this.target.dispatch(receiveTransaction(this.target.state, steps, clientIds, { mapSelectionBackward: true }));
  }

  private scheduleRetry(): void {
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => void this.flush(), this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, this.maxRetryMs);
  }

  private setStatus(status: SaveStatus): void {
    if (status === this.status) return;
    this.status = status;
    this.onStatusChange(status);
  }

  private resolveIdleWaiters(): void {
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const resolve of waiters) resolve();
  }
}

function browserOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}
