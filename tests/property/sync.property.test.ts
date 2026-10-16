// Property tests of saving and collaboration: random edits by two editors over a network that
// delays requests, fails them and loses answers, with crashes whose unsaved edits are restored from
// the browser's store when the document opens again. PROPERTY_RUNS sets the number of cases
// (PROPERTY_RUNS=20000 for a long run); PROPERTY_SEED replays one.
import { documentSchema } from "@docs/shared";
import type { Node } from "@tiptap/pm/model";
import { Step, Transform } from "@tiptap/pm/transform";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCommentAnchors } from "../../client/src/editor/commentAnchors.ts";
import { createComment } from "../../server/src/comments.ts";
import { getStepsSince } from "../../server/src/documents.ts";
import { buildEdit, countOf, editArbitrary, type Edit, type EditKind } from "./edits.ts";
import { random, reliable, startDocument, World, type Client } from "./world.ts";

const runs = Number(process.env.PROPERTY_RUNS) || 100;
const seed = process.env.PROPERTY_SEED ? Number(process.env.PROPERTY_SEED) : undefined;
const settings = { numRuns: runs, ...(seed !== undefined && { seed }) };

type Action =
  | { kind: "edit"; client: number; edit: Edit }
  | { kind: "wait"; ms: number }
  | { kind: "network"; failure: number; lostAnswer: number; maxDelayMs: number }
  | { kind: "offline"; offline: boolean }
  | { kind: "crash"; client: number }
  | { kind: "mode"; client: number; suggesting: boolean };

function actions(kinds: readonly EditKind[], options: { crashes: boolean; modes: boolean }) {
  const action: fc.Arbitrary<Action> = fc.oneof(
    { weight: 8, arbitrary: fc.record({ kind: fc.constant("edit" as const), client: fc.nat({ max: 1 }), edit: editArbitrary(kinds) }) },
    { weight: 3, arbitrary: fc.record({ kind: fc.constant("wait" as const), ms: fc.integer({ min: 0, max: 3000 }) }) },
    {
      weight: 1,
      arbitrary: fc.record({
        kind: fc.constant("network" as const),
        failure: fc.constantFrom(0, 0.2, 0.6),
        lostAnswer: fc.constantFrom(0, 0.2, 0.6),
        maxDelayMs: fc.constantFrom(0, 50, 800),
      }),
    },
    { weight: 1, arbitrary: fc.record({ kind: fc.constant("offline" as const), offline: fc.boolean() }) },
    ...(options.crashes ? [{ weight: 1, arbitrary: fc.record({ kind: fc.constant("crash" as const), client: fc.nat({ max: 1 }) }) }] : []),
    ...(options.modes ? [{ weight: 1, arbitrary: fc.record({ kind: fc.constant("mode" as const), client: fc.nat({ max: 1 }), suggesting: fc.boolean() }) }] : []),
  );
  return fc.array(action, { minLength: 1, maxLength: 80, size: "large" });
}

/**
 * Text typed by the editors: unique tokens, so a step applied twice shows as a token twice. Each
 * is one private-use character, so splitting a paragraph or inserting text cannot cut it in two.
 */
export class Tokens {
  private count = 0;
  /** Tokens that were saved on the server or kept in the browser when their editor crashed. */
  readonly kept = new Set<string>();
  readonly all: string[] = [];

  next(): string {
    const token = String.fromCharCode(0xe000 + ++this.count);
    this.all.push(token);
    return token;
  }
}

/** Waits (in fake time) until every live editor has saved everything, restoring kept edits on the way. */
async function settle(world: World): Promise<void> {
  world.network = reliable;
  world.offline = false;
  // Kept edits left by crashed sessions are restored by an open editor, as when the browser is back online.
  const live = () => world.clients.filter((client) => !client.crashed);
  if (live().length === 0) world.open();
  for (const client of live()) {
    client.sync.connectionRestored();
    await restoring(client);
  }
  for (let round = 0; round < 50; round++) {
    await vi.advanceTimersByTimeAsync(5000);
    if (live().every((client) => !client.sync.hasUnsavedChanges && client.sync.saveStatus === "saved")) break;
  }
  for (const client of live()) client.catchUp();
}

async function restoring(client: Client): Promise<void> {
  const done = client.restore();
  for (let round = 0; round < 20; round++) {
    let finished = false;
    void done.then(() => (finished = true));
    await vi.advanceTimersByTimeAsync(1000);
    if (finished) break;
  }
  await done;
}

/** Applies every stored step to the document the server started from. */
function replayed(world: World): Node {
  const { steps } = getStepsSince(world.db, world.documentId, 0)!;
  const transform = new Transform(world.initial);
  for (const json of steps) transform.step(Step.fromJSON(documentSchema, json));
  return transform.doc;
}

export async function run(actionList: Action[], options: { seed: number; tokens: Tokens; comments?: boolean }) {
  const world = new World(startDocument, random(options.seed));
  if (options.comments) {
    // Comments on "quick" and "lazy dog", made before the editors open.
    for (const [from, to] of [
      [13, 18],
      [startDocument.content.size - 9, startDocument.content.size - 1],
    ] as const) {
      createComment(world.db, world.documentId, { version: 0, doc: startDocument }, { version: 0, from, to, body: "Note" });
    }
  }
  world.open();
  world.open();
  for (const action of actionList) {
    const live = world.clients.filter((client) => !client.crashed);
    switch (action.kind) {
      case "edit": {
        const client = live[action.client % live.length];
        if (!client) break;
        const edit = action.edit.kind === "type" ? { ...action.edit, text: options.tokens.next() } : action.edit;
        const tr = buildEdit(client.state, edit);
        if (tr) client.dispatch(tr);
        break;
      }
      case "wait":
        await vi.advanceTimersByTimeAsync(action.ms);
        break;
      case "network":
        world.network = action;
        break;
      case "offline":
        world.offline = action.offline;
        if (action.offline) for (const client of live) client.sync.connectionLost();
        else for (const client of live) client.sync.connectionRestored();
        break;
      case "crash": {
        const client = live[action.client % live.length];
        if (!client) break;
        client.crash();
        // What was saved, or kept in the browser, must survive; the rest may be lost.
        const entry = world.store.entries.get(`${world.documentId}:${client.clientId}`);
        const kept = JSON.stringify(entry?.steps ?? []) + world.serverDoc().textContent;
        for (const token of options.tokens.all) if (kept.includes(token)) options.tokens.kept.add(token);
        // The document is opened again and restores what the crashed session kept.
        await restoring(world.open());
        break;
      }
      case "mode": {
        const client = live[action.client % live.length];
        if (!client) break;
        const { setSuggesting } = await import("../../client/src/editor/suggesting.ts");
        client.dispatch(setSuggesting(client.state.tr, { mode: action.suggesting ? "suggesting" : "editing" }));
        break;
      }
    }
  }
  await settle(world);
  return world;
}

function checkConverged(world: World): void {
  const server = world.serverDoc();
  server.check();
  // Reloading reproduces the document: its stored content is its stored steps applied in order.
  expect(replayed(world).eq(server)).toBe(true);
  for (const client of world.clients.filter((candidate) => !candidate.crashed)) {
    expect(client.rejected).toBe(false);
    expect(client.unsaved).toBe(false);
    expect(client.version).toBe(world.opened().version);
    expect(client.state.doc.toJSON()).toEqual(server.toJSON());
  }
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("saving and collaboration (property)", () => {
  const editing: EditKind[] = ["type", "delete", "mark", "split", "join", "blockType", "list", "insert", "table", "image", "docAttr", "tab", "undo", "redo"];

  it("two editors and the server agree after random edits, network failures, lost answers and crashes", { timeout: 600_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer(), actions(editing, { crashes: true, modes: true }), async (worldSeed, list) => {
        const tokens = new Tokens();
        const world = await run(list, { seed: worldSeed, tokens });
        checkConverged(world);
        // No step was applied twice: every typed token is there at most once. (Duplicating a tab copies
        // them, and merging cells moves a cell's text as a deletion and an insertion, so text typed
        // into that cell by the other editor at the same time can end up in both places.)
        const copies = (action: Action) =>
          action.kind === "edit" && ((action.edit.kind === "tab" && action.edit.op === "duplicate") || (action.edit.kind === "table" && action.edit.op === "merge"));
        if (!list.some(copies)) {
          const doc = world.serverDoc();
          for (const token of tokens.all) expect(countOf(doc, token)).toBeLessThanOrEqual(1);
        }
      }),
      settings,
    );
  });

  it("edits saved or kept in the browser before a crash are on the server exactly once", { timeout: 600_000 }, async () => {
    // Only edits that never remove text, so every kept token must be there in the end. (Inserting
    // an object in an empty paragraph replaces the paragraph, and text typed into it concurrently
    // goes with it, as with any concurrent deletion.)
    const inserting: EditKind[] = ["type", "split", "mark", "blockType", "list", "docAttr"];
    await fc.assert(
      fc.asyncProperty(fc.integer(), actions(inserting, { crashes: true, modes: false }), async (worldSeed, list) => {
        const tokens = new Tokens();
        const world = await run(list, { seed: worldSeed, tokens });
        checkConverged(world);
        const doc = world.serverDoc();
        for (const token of tokens.all) expect(countOf(doc, token)).toBeLessThanOrEqual(1);
        for (const token of tokens.kept) expect(countOf(doc, token), `${token} was kept`).toBe(1);
        // Live editors' edits all reach the server.
        expect(world.store.entries.size).toBe(0);
      }),
      settings,
    );
  });

  it("cases found before, replayed", { timeout: 60_000 }, async () => {
    // A selected horizontal line, then steps received over a rebase (failed on mapping the node selection).
    const list: Action[] = [
      { kind: "edit", client: 0, edit: { kind: "tab", op: "add", index: 0 } },
      { kind: "edit", client: 0, edit: { kind: "tab", op: "delete", index: 0 } },
      { kind: "network", failure: 0, lostAnswer: 0, maxDelayMs: 800 },
      { kind: "edit", client: 1, edit: { kind: "insert", at: 0.9849, object: "horizontalRule" } },
      { kind: "wait", ms: 301 },
      { kind: "edit", client: 1, edit: { kind: "blockType", at: 0, level: 0 } },
      { kind: "offline", offline: true },
      { kind: "wait", ms: 848 },
      { kind: "edit", client: 0, edit: { kind: "mark", from: 0, to: 0, mark: "bold" } },
    ];
    checkConverged(await run(list, { seed: 0, tokens: new Tokens() }));

    // A deletion that shrank when rebased (part of its text was deleted by the other editor), then
    // undone: the undo puts back what it deleted, once.
    const tokens = new Tokens();
    const shrunk: Action[] = [
      { kind: "edit", client: 1, edit: { kind: "delete", from: 0.9849, to: 0 } },
      { kind: "crash", client: 0 },
      { kind: "edit", client: 1, edit: { kind: "type", at: 0, text: "a" } },
      { kind: "network", failure: 0, lostAnswer: 0, maxDelayMs: 800 },
      { kind: "wait", ms: 500 },
      { kind: "edit", client: 1, edit: { kind: "delete", from: 0, to: 0.0299 } },
      { kind: "edit", client: 1, edit: { kind: "undo" } },
      { kind: "edit", client: 0, edit: { kind: "list", at: 0, list: "bulletList" } },
    ];
    const world = await run(shrunk, { seed: 0, tokens });
    checkConverged(world);
    for (const token of tokens.all) expect(countOf(world.serverDoc(), token)).toBeLessThanOrEqual(1);
  });

  it("comment anchors in the editors match the server's after concurrent edits", { timeout: 600_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer(), actions(["type", "delete", "split", "join", "mark", "insert", "undo", "redo"], { crashes: false, modes: false }), async (worldSeed, list) => {
        const world = await run(list, { seed: worldSeed, tokens: new Tokens(), comments: true });
        checkConverged(world);
        const server = world.comments().map(({ id, from, to }) => ({ id, from, to }));
        for (const client of world.clients.filter((candidate) => !candidate.crashed)) {
          expect(getCommentAnchors(client.state).anchors.map(({ id, from, to }) => ({ id, from, to }))).toEqual(server);
        }
      }),
      settings,
    );
  });
});
