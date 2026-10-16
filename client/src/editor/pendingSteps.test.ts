import { documentSchema } from "@pubky-write/shared";
import { Node } from "@tiptap/pm/model";
import { Step, Transform } from "@tiptap/pm/transform";
import { describe, expect, it } from "vitest";
import { wrapInList } from "@tiptap/pm/schema-list";
import { EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";
import { collab, receiveTransaction, sendableSteps } from "./collab.ts";
import { entryText, parseSteps, PendingPersister, rebasePending, type PendingEntry, type PendingStore } from "./pendingSteps.ts";

const docOf = (text: string) =>
  Node.fromJSON(documentSchema, { type: "doc", content: [{ type: "paragraph", ...(text && { content: [{ type: "text", text }] }) }] });
const textOf = (doc: Node) => doc.textContent;

/** Steps that type `text` at `pos`, one character per step, starting from `doc`. */
function typing(doc: Node, pos: number, text: string): { steps: Step[]; doc: Node } {
  const transform = new Transform(doc);
  [...text].forEach((character, index) => transform.insert(pos + index, documentSchema.text(character)));
  return { steps: transform.steps, doc: transform.doc };
}

function applyAll(doc: Node, steps: readonly Step[]): Node {
  const transform = new Transform(doc);
  for (const step of steps) transform.step(step);
  return transform.doc;
}

describe("rebasePending", () => {
  const base = docOf("Hello");

  it("skips the steps the server applied before the session ended, so nothing is applied twice", () => {
    // The tab sent "!!" and closed before it heard back: the server has the steps, the browser still has them too.
    const pending = typing(base, 6, "!!");
    const serverDoc = pending.doc;
    const result = rebasePending(serverDoc, pending.steps, "old", { steps: pending.steps, clientIds: ["old", "old"] }, []);
    expect(result).toMatchObject({ steps: [], alreadySaved: 2, dropped: 0 });
    expect(textOf(applyAll(serverDoc, result.steps))).toBe("Hello!!");
  });

  it("sends only the rest when the server had the first batch, after other edits", () => {
    const pending = typing(base, 6, " world");
    const firstBatch = pending.steps.slice(0, 3); // " wo"
    const afterFirst = applyAll(base, firstBatch);
    const other = typing(afterFirst, 1, ">> ");
    const serverDoc = other.doc;
    const result = rebasePending(serverDoc, pending.steps, "old", { steps: [...firstBatch, ...other.steps], clientIds: ["old", "old", "old", "x", "x", "x"] }, []);
    expect(result.alreadySaved).toBe(3);
    expect(textOf(applyAll(serverDoc, result.steps))).toBe(">> Hello world");
  });

  it("rebases over other clients' steps and the editor's own unsaved steps", () => {
    const pending = typing(base, 6, "!");
    const other = typing(base, 1, "Oh, ");
    const local = typing(other.doc, other.doc.content.size - 1, " (draft)");
    const result = rebasePending(local.doc, pending.steps, "old", { steps: other.steps, clientIds: other.steps.map(() => "x") }, local.steps);
    expect(result).toMatchObject({ alreadySaved: 0, dropped: 0 });
    // Both were typed at the end of "Hello": the restored text goes after the newer one, as when collab rebases.
    expect(textOf(applyAll(local.doc, result.steps))).toBe("Oh, Hello (draft)!");
  });

  it("does not treat another client's identical steps as its own", () => {
    const pending = typing(base, 6, "!");
    const serverDoc = applyAll(base, pending.steps);
    const result = rebasePending(serverDoc, pending.steps, "old", { steps: pending.steps, clientIds: ["someone else"] }, []);
    expect(result.alreadySaved).toBe(0);
    expect(textOf(applyAll(serverDoc, result.steps))).toBe("Hello!!");
  });
});

describe("rebasePending with steps that no longer apply", () => {
  it("drops the undo of a dropped deletion, so its text is not inserted twice", () => {
    const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
    const base = Node.fromJSON(documentSchema, { type: "doc", content: [paragraph("A"), paragraph("B"), paragraph("C")] });
    // Kept offline: "A" and "B" deleted, then the deletion undone.
    const deleted = new Transform(base).delete(0, 6);
    const pending = [...deleted.steps, deleted.steps[0]!.invert(base)];
    // Meanwhile this editor turned "A" into a list item, which the deletion no longer fits.
    const state = EditorState.create({ doc: base, selection: TextSelection.create(base, 1) });
    let local: Transaction | null = null;
    wrapInList(documentSchema.nodes.bulletList!)(state, (tr) => (local = tr));
    const doc = local!.doc;
    const result = rebasePending(doc, pending, "old", { steps: [], clientIds: [] }, local!.steps);
    expect(result.dropped).toBe(2);
    expect(applyAll(doc, result.steps).textContent).toBe("ABC");
  });

  it("also when the undo of a group of deletions undoes them in reverse order", () => {
    const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
    const base = Node.fromJSON(documentSchema, { type: "doc", content: [paragraph("A"), paragraph("B"), paragraph("Cde")] });
    // Two deletions undone together: the second one's undo first.
    const deleted = new Transform(base).delete(0, 6);
    deleted.delete(2, 3);
    const undo = new Transform(deleted.doc);
    undo.step(deleted.steps[1]!.invert(deleted.docs[1]!));
    undo.step(deleted.steps[0]!.invert(base));
    const pending = [...deleted.steps, ...undo.steps];
    const state = EditorState.create({ doc: base, selection: TextSelection.create(base, 1) });
    let local: Transaction | null = null;
    wrapInList(documentSchema.nodes.bulletList!)(state, (tr) => (local = tr));
    const result = rebasePending(local!.doc, pending, "old", { steps: [], clientIds: [] }, local!.steps);
    expect(applyAll(local!.doc, result.steps).textContent).toBe("ABCde");
  });
});

describe("stored entries", () => {
  const entry = (overrides: Partial<PendingEntry>): PendingEntry => ({
    key: "d:c",
    documentId: "d",
    clientId: "c",
    version: 0,
    steps: [],
    text: "",
    savedAt: 0,
    ...overrides,
  });

  it("parses stored steps, or refuses all of them if one does not fit the schema", () => {
    const steps = typing(docOf(""), 1, "ab").steps.map((step) => step.toJSON());
    expect(parseSteps(steps)).toHaveLength(2);
    expect(parseSteps([...steps, { stepType: "nonsense" }])).toBeNull();
  });

  it("removes the session's own earlier entry when it restores another one with nothing left unsaved", async () => {
    const written = new Map<string, PendingEntry>();
    const store: PendingStore = {
      put: async (value) => void written.set(value.key, value),
      remove: async (key) => void written.delete(key),
      replace: async (keys, value) => {
        for (const key of keys) written.delete(key);
        if (value) written.set(value.key, value);
      },
      list: async () => [...written.values()],
    };
    const base = docOf("Hi");
    let state = EditorState.create({ doc: base, plugins: [collab({ clientID: "c" })] });
    const target = { get state() { return state; }, dispatch: (tr: Transaction) => (state = state.apply(tr)) };
    const persister = new PendingPersister("d", "c", target, store);
    target.dispatch(state.tr.insertText("!", 3));
    await persister.save();
    expect([...written.keys()]).toEqual(["d:c"]);
    // The step is confirmed, then another session's entry is restored with nothing to add.
    target.dispatch(receiveTransaction(state, sendableSteps(state)!.steps, ["c"]));
    written.set("d:other", entry({ key: "d:other", clientId: "other" }));
    await persister.replace("d:other");
    expect([...written.keys()]).toEqual([]);
  });

  it("offers the saved text, or the text the steps add", () => {
    expect(entryText(entry({ text: "Whole document" }))).toBe("Whole document");
    const steps = typing(docOf(""), 1, "Hi").steps.map((step) => step.toJSON());
    expect(entryText(entry({ steps }))).toBe("Hi");
  });
});
