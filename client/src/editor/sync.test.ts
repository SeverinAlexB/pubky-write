import type { SubmitStepsRequest } from "@docs/shared";
import { documentSchema } from "@docs/shared";
import { collab, getVersion, sendableSteps } from "prosemirror-collab";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import { Step } from "@tiptap/pm/transform";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentSync, RejectedError, type SaveStatus, type StepsTransport, type SubmitResult } from "./sync.ts";

/** A minimal stand-in for an editor view: holds state and applies dispatched transactions. */
class FakeEditor {
  state: EditorState;

  constructor(clientID: string, version = 0) {
    this.state = EditorState.create({
      schema: documentSchema,
      plugins: [collab({ version, clientID })],
    });
  }

  dispatch(transaction: Transaction): void {
    this.state = this.state.apply(transaction);
  }

  type(text: string): void {
    this.dispatch(this.state.tr.insertText(text, this.state.doc.content.size - 1));
  }

  get text(): string {
    return this.state.doc.textContent;
  }
}

/** An in-memory server that applies steps like the real one. */
class FakeServer implements StepsTransport {
  doc = documentSchema.node("doc", null, [documentSchema.node("paragraph")]);
  steps: { step: unknown; clientId: string }[] = [];
  requests: SubmitStepsRequest[] = [];
  failNext: Error | null = null;

  async submit(request: SubmitStepsRequest): Promise<SubmitResult> {
    this.requests.push(request);
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = null;
      throw error;
    }
    if (request.version !== this.steps.length) {
      const missing = this.steps.slice(request.version);
      return {
        kind: "conflict",
        version: this.steps.length,
        steps: missing.map((entry) => entry.step),
        clientIds: missing.map((entry) => entry.clientId),
      };
    }
    for (const json of request.steps) {
      this.doc = Step.fromJSON(documentSchema, json).apply(this.doc).doc!;
      this.steps.push({ step: json, clientId: request.clientId });
    }
    return { kind: "accepted", version: this.steps.length };
  }
}

function createSync(editor: FakeEditor, server: StepsTransport) {
  const statuses: SaveStatus[] = [];
  const sync = new DocumentSync(editor, server, {
    debounceMs: 300,
    initialRetryMs: 1000,
    onStatusChange: (status) => statuses.push(status),
  });
  return { sync, statuses };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("DocumentSync", () => {
  it("batches edits made within the debounce window into one request", async () => {
    const editor = new FakeEditor("a");
    const server = new FakeServer();
    const { sync, statuses } = createSync(editor, server);

    editor.type("Hel");
    sync.notifyChange();
    await vi.advanceTimersByTimeAsync(100);
    editor.type("lo");
    sync.notifyChange();
    expect(server.requests).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(300);

    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]!.steps).toHaveLength(2);
    expect(server.doc.textContent).toBe("Hello");
    expect(getVersion(editor.state)).toBe(2);
    expect(sendableSteps(editor.state)).toBeNull();
    expect(statuses).toEqual(["saving", "saved"]);
  });

  it("keeps one request in flight and sends later edits afterwards", async () => {
    const editor = new FakeEditor("a");
    let release!: () => void;
    const server = new FakeServer();
    const slowServer: StepsTransport = {
      submit: async (request) => {
        await new Promise<void>((resolve) => (release = resolve));
        return server.submit(request);
      },
    };
    const { sync } = createSync(editor, slowServer);

    editor.type("one");
    sync.notifyChange();
    await vi.advanceTimersByTimeAsync(300);
    editor.type(" two");
    sync.notifyChange();
    await vi.advanceTimersByTimeAsync(300);
    expect(server.requests).toHaveLength(0); // first request still waiting

    release();
    await vi.advanceTimersByTimeAsync(0);
    release();
    await vi.advanceTimersByTimeAsync(0);

    expect(server.requests.map((request) => request.version)).toEqual([0, 1]);
    expect(server.doc.textContent).toBe("one two");
    expect(sync.saveStatus).toBe("saved");
  });

  it("rebases local edits on top of steps from another client", async () => {
    const server = new FakeServer();
    const first = new FakeEditor("a");
    const second = new FakeEditor("b");
    const { sync: firstSync } = createSync(first, server);
    const { sync: secondSync } = createSync(second, server);

    first.type("A");
    firstSync.notifyChange();
    second.type("B");
    secondSync.notifyChange();
    await vi.advanceTimersByTimeAsync(300);

    expect(server.requests.map((request) => [request.clientId, request.version])).toEqual([
      ["a", 0],
      ["b", 0], // conflict: built on version 0, server is at 1
      ["b", 1], // rebased and resent
    ]);
    expect(server.doc.textContent).toBe("AB");
    expect(second.text).toBe("AB");
    expect(getVersion(second.state)).toBe(2);
  });

  it("goes offline on network errors and retries with backoff", async () => {
    const editor = new FakeEditor("a");
    const server = new FakeServer();
    const { sync, statuses } = createSync(editor, server);
    server.failNext = new TypeError("Failed to fetch");

    editor.type("Hi");
    sync.notifyChange();
    await vi.advanceTimersByTimeAsync(300);
    expect(sync.saveStatus).toBe("offline");
    expect(sync.hasUnsavedChanges).toBe(true);

    await vi.advanceTimersByTimeAsync(1000);

    expect(server.doc.textContent).toBe("Hi");
    expect(statuses).toEqual(["saving", "offline", "saving", "saved"]);
  });

  it("stops and reports an error when the server rejects the batch", async () => {
    const editor = new FakeEditor("a");
    const server = new FakeServer();
    const { sync } = createSync(editor, server);
    server.failNext = new RejectedError("Invalid step");

    editor.type("Hi");
    sync.notifyChange();
    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(sync.saveStatus).toBe("error");
    expect(server.requests).toHaveLength(1);
  });

  it("flushNow sends immediately and resolves once saved", async () => {
    const editor = new FakeEditor("a");
    const server = new FakeServer();
    const { sync } = createSync(editor, server);

    editor.type("Now");
    sync.notifyChange();
    await sync.flushNow();

    expect(server.doc.textContent).toBe("Now");
    expect(sync.hasUnsavedChanges).toBe(false);
  });
});
