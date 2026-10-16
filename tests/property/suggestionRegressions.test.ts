// Cases the property tests found, kept as plain tests: each is made in Suggesting mode and
// rejecting all suggestions must give back the document it started from.
import type { Node } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { resolveSuggestions, setSuggesting } from "../../client/src/editor/suggesting.ts";
import { buildEdit, type Edit } from "./edits.ts";
import { dispatchTo, editorState, startDocument } from "./world.ts";

let clock = 1_000_000;

function run(state: EditorState, edits: Edit[]): EditorState {
  for (const edit of edits) {
    const tr = buildEdit(state, edit);
    if (tr) state = dispatchTo(state, tr.setTime((clock += 1000)), clock);
  }
  return state;
}

function rejectAfter(before: Edit[], during: Edit[]): { original: Node; rejected: Node } {
  const original = run(editorState(startDocument, { version: 0, clientID: "me", mode: "editing", comments: [] }), before).doc;
  let state = editorState(original, { version: 0, clientID: "me", mode: "editing", comments: [] });
  state = dispatchTo(state, setSuggesting(state.tr, { mode: "suggesting" }), clock);
  state = run(state, during);
  const tr = resolveSuggestions(state, "reject", null);
  return { original, rejected: tr ? dispatchTo(state, tr, clock).doc : state.doc };
}

describe("suggestions found by the property tests", () => {
  const cases: [string, Edit[], Edit[]][] = [
    ["a list started on a paragraph that then gets text", [{ kind: "split", at: 0 }], [{ kind: "list", at: 0, list: "bulletList" }, { kind: "type", at: 0, text: "x" }]],
    ["a selection deleted from a heading into a list item", [], [{ kind: "delete", from: 0.0152, to: 0.394 }]],
    ["a table put in the middle of a heading", [], [{ kind: "insert", at: 0.0152, object: "table" }]],
    ["Enter at the start of a heading", [], [{ kind: "split", at: 0 }, { kind: "list", at: 0, list: "bulletList" }]],
    ["a list item nested under the one before", [], [{ kind: "list", at: 0.4546, list: "bulletList" }]],
    ["the first list item taken out of its list", [], [{ kind: "join", at: 0.2223 }]],
    ["a selection deleted from a list item into the paragraph after the table", [], [{ kind: "delete", from: 0.6364, to: 0.4091 }]],
    ["a new table's row and the text after it deleted", [], [{ kind: "insert", at: 0.1061, object: "table" }, { kind: "delete", from: 0.1127, to: 0.1831 }]],
    ["a heading turned into a list item", [], [{ kind: "blockType", at: 0, level: 0 }, { kind: "list", at: 0, list: "bulletList" }, { kind: "blockType", at: 0, level: 0 }]],
    ["a paragraph joined into an empty list item", [{ kind: "blockType", at: 0.6364, level: 1 }, { kind: "delete", from: 0.091, to: 0.6213 }], [{ kind: "list", at: 0.1936, list: "bulletList" }, { kind: "join", at: 0.6667 }]],
    ["a new column's cell deleted with text before the table", [], [{ kind: "table", at: 0.5152, op: "addColumn" }, { kind: "delete", from: 0, to: 0.5589 }]],
    ["Backspace on a paragraph break already suggested for deletion", [{ kind: "delete", from: 0.0152, to: 0.6213 }, { kind: "split", at: 0 }], [{ kind: "list", at: 0, list: "bulletList" }, { kind: "delete", from: 0.0371, to: 0 }, { kind: "join", at: 0.3334 }]],
    ["an empty list item taken out of its list and put in another kind", [], [{ kind: "split", at: 0.394 }, { kind: "join", at: 0.2 }, { kind: "list", at: 0.3881, list: "orderedList" }]],
  ];
  it.each(cases)("rejecting %s gives back the document", (_name, before, during) => {
    const { original, rejected } = rejectAfter(before, during);
    expect(rejected.toJSON()).toEqual(original.toJSON());
  });
});
