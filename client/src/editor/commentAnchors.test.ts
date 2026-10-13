import { documentSchema } from "@docs/shared";
import { EditorState } from "@tiptap/pm/state";
import type { DecorationSet } from "@tiptap/pm/view";
import { describe, expect, it } from "vitest";
import { commentAt, CommentAnchors, getCommentAnchors, updateCommentAnchors } from "./commentAnchors.ts";

function createState() {
  const extension = CommentAnchors.configure({
    initial: [
      { id: 1, from: 5, to: 10, resolved: false },
      { id: 2, from: 11, to: 16, resolved: true },
    ],
  });
  const plugins = extension.config.addProseMirrorPlugins!.call({ options: extension.options } as never);
  const doc = documentSchema.node("doc", null, [documentSchema.node("paragraph", null, [documentSchema.text("The quick brown fox")])]);
  return EditorState.create({ doc, plugins });
}

describe("comment anchors in the editor", () => {
  it("move with edits like the server's anchors", () => {
    let state = createState();
    state = state.apply(state.tr.insertText("Look: ", 1)); // before both
    state = state.apply(state.tr.insertText("!", 11)); // at the start edge of "quick": stays outside
    expect(getCommentAnchors(state).anchors.map(({ id, from, to }) => [id, from, to])).toEqual([
      [1, 12, 17],
      [2, 18, 23],
    ]);
    expect(state.doc.textBetween(12, 17)).toBe("quick");
  });

  it("collapse when the commented text is deleted", () => {
    let state = createState();
    state = state.apply(state.tr.delete(4, 11));
    expect(getCommentAnchors(state).anchors[0]).toMatchObject({ id: 1, from: 4, to: 4 });
  });

  it("track a draft selection and accept new, resolved and removed threads", () => {
    let state = createState();
    state = state.apply(updateCommentAnchors(state.tr, { type: "draft", anchor: { from: 17, to: 20 } }));
    state = state.apply(state.tr.insertText("big ", 17));
    expect(getCommentAnchors(state).draft).toEqual({ from: 21, to: 24 });

    state = state.apply(updateCommentAnchors(state.tr, { type: "upsert", anchor: { id: 3, from: 21, to: 24, resolved: false } }));
    state = state.apply(updateCommentAnchors(state.tr, { type: "remove", id: 1 }));
    expect(getCommentAnchors(state).anchors.map((anchor) => anchor.id)).toEqual([2, 3]);
  });

  it("finds the open comment under a position", () => {
    const anchors = getCommentAnchors(createState());
    expect(commentAt(anchors, 7)).toBe(1);
    expect(commentAt(anchors, 13)).toBeNull(); // resolved
    expect(commentAt(anchors, 5)).toBeNull(); // edge
  });

  it("hide every highlight while comments are hidden, and deactivate the thread", () => {
    let state = createState();
    state = state.apply(updateCommentAnchors(state.tr, { type: "activate", id: 1 }));
    const plugin = state.plugins[0]!;
    const decorations = () => (plugin.props.decorations!.call(plugin, state) as DecorationSet).find();
    expect(decorations()).toHaveLength(1);
    state = state.apply(updateCommentAnchors(state.tr, { type: "hide", hidden: true }));
    expect(getCommentAnchors(state)).toMatchObject({ hidden: true, activeId: null });
    expect(decorations()).toHaveLength(0);
  });
});
