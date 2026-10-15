import { documentSchema } from "@docs/shared";
import { history, undo } from "@tiptap/pm/history";
import { Node } from "@tiptap/pm/model";
import { wrapInList } from "@tiptap/pm/schema-list";
import { EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";
import { AddMarkStep, RemoveMarkStep, Transform } from "@tiptap/pm/transform";
import { describe, expect, it } from "vitest";
import { collab, collabKey, exactInverse, receiveTransaction, RestoreMarksStep, sendableSteps } from "./collab.ts";

const bold = documentSchema.marks.bold!.create();
const paragraph = (text: string, marks?: unknown[]) => ({ type: "paragraph", content: [{ type: "text", text, ...(marks && { marks }) }] });
const docOf = (...content: unknown[]) => Node.fromJSON(documentSchema, { type: "doc", content });

function stateOf(doc: Node, clientID = "me") {
  return EditorState.create({ doc, plugins: [history(), collab({ clientID })] });
}

const apply = (state: EditorState, tr: Transaction) => state.applyTransaction(tr).state;

describe("exactInverse", () => {
  it("restores the marks of text that had the mark before a mark step", () => {
    // "abc" with "b" bold: bolding all of it and inverting must leave "b" bold.
    const doc = docOf({ type: "paragraph", content: [{ type: "text", text: "a" }, { type: "text", text: "b", marks: [{ type: "bold" }] }, { type: "text", text: "c" }] });
    for (const step of [new AddMarkStep(1, 4, bold), new RemoveMarkStep(1, 4, bold)]) {
      const after = step.apply(doc).doc!;
      const inverse = exactInverse(step, doc);
      expect(inverse.apply(after).doc!.eq(doc)).toBe(true);
    }
    // Where the library's inverse is exact, it is kept.
    const plain = docOf(paragraph("abc"));
    expect(exactInverse(new AddMarkStep(1, 4, bold), plain)).toBeInstanceOf(RemoveMarkStep);
  });

  it("maps and reads back from JSON", () => {
    const doc = docOf({ type: "paragraph", content: [{ type: "text", text: "a" }, { type: "text", text: "b", marks: [{ type: "bold" }] }] });
    const step = RestoreMarksStep.of(doc, 1, 3);
    const moved = step.map(new Transform(doc).insert(1, documentSchema.text("xx")).mapping) as RestoreMarksStep;
    expect([moved.from, moved.to]).toEqual([3, 5]);
    expect(RestoreMarksStep.fromJSON(documentSchema, step.toJSON() as never).toJSON()).toEqual(step.toJSON());
  });
});

describe("receiveTransaction", () => {
  it("keeps another session's formatting when a rebased mark step is undone again", () => {
    const base = docOf(paragraph("Title"));
    // The other session bolds "it"; this one bolds "Tit" at the same time.
    const theirs = new Transform(base).addMark(2, 4, bold).steps;
    let state = stateOf(base);
    state = apply(state, state.tr.addMark(1, 4, bold));
    state = apply(state, receiveTransaction(state, theirs, ["other"]));
    // Rebasing again first undoes the rebased step: that must not remove the other session's bold.
    const { inverted } = collabKey.getState(state)!.unconfirmed[0]!;
    const undone = inverted.apply(state.doc).doc!;
    expect(undone.eq(new Transform(base).addMark(2, 4, bold).doc)).toBe(true);
  });

  it("drops the undo of a step that no longer applies, so its text is not inserted twice", () => {
    const base = docOf(paragraph("A"), paragraph("B"), paragraph("C"));
    // The other session turns "A" into a list item while this one deletes "A" and "B" and undoes it.
    const other = EditorState.create({ doc: base, selection: TextSelection.create(base, 1) });
    let theirs: Transaction | null = null;
    wrapInList(documentSchema.nodes.bulletList!)(other, (tr) => (theirs = tr));
    let state = stateOf(base);
    state = apply(state, state.tr.delete(0, 6));
    undo(state, (tr) => (state = apply(state, tr)));
    expect(state.doc.eq(base)).toBe(true);
    state = apply(state, receiveTransaction(state, theirs!.steps, ["other"]));
    // What the server ends with: the list and the rest, as the deletion and its undo cancel out.
    const server = new Transform(base);
    for (const step of theirs!.steps) server.step(step);
    for (const step of sendableSteps(state)?.steps ?? []) server.step(step);
    expect(state.doc.eq(server.doc)).toBe(true);
    expect(state.doc.textContent).toBe("ABC");
  });
});

