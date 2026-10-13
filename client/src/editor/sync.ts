// Sends local edits to the server as batches of ProseMirror steps, modelled on how the reference product saves:
// edits are debounced into batches, only one batch is in flight at a time, and each batch is stamped
// with the version it was built on. If the server has moved on, it answers with the steps this client
// is missing; prosemirror-collab rebases the local steps on top of them and they are sent again.
import type { SubmitStepsRequest } from "@docs/shared";
import { documentSchema } from "@docs/shared";
import { receiveTransaction, sendableSteps } from "prosemirror-collab";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { Step } from "@tiptap/pm/transform";

export type SaveStatus = "saved" | "saving" | "offline" | "error";

export type SubmitResult =
  | { kind: "accepted"; version: number }
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
};

export class DocumentSync {
  private status: SaveStatus = "saved";
  private inFlight = false;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retryMs: number;
  private destroyed = false;
  private idleWaiters: (() => void)[] = [];

  private readonly debounceMs: number;
  private readonly initialRetryMs: number;
  private readonly maxRetryMs: number;
  private readonly onStatusChange: (status: SaveStatus) => void;

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

  destroy(): void {
    this.destroyed = true;
    clearTimeout(this.flushTimer);
    clearTimeout(this.retryTimer);
    this.resolveIdleWaiters();
  }

  private async flush(): Promise<void> {
    if (this.destroyed || this.inFlight || this.status === "error") return;
    const sendable = sendableSteps(this.target.state);
    if (!sendable) {
      this.setStatus("saved");
      this.resolveIdleWaiters();
      return;
    }

    this.inFlight = true;
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
        result.steps.map((json) => Step.fromJSON(documentSchema, json)),
        result.clientIds,
      );
    }
    // Edits made while the request was in flight, or steps rebased after a conflict, go next.
    void this.flush();
  }

  private receive(steps: readonly Step[], clientIds: readonly (string | number)[]): void {
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
