import { documentSchema } from "@docs/shared";
import { Node } from "@tiptap/pm/model";
import { Step, Transform } from "@tiptap/pm/transform";
import { describe, expect, it } from "vitest";
import { entryText, parseSteps, rebasePending, type PendingEntry } from "./pendingSteps.ts";

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

  it("offers the saved text, or the text the steps add", () => {
    expect(entryText(entry({ text: "Whole document" }))).toBe("Whole document");
    const steps = typing(docOf(""), 1, "Hi").steps.map((step) => step.toJSON());
    expect(entryText(entry({ steps }))).toBe("Hi");
  });
});
