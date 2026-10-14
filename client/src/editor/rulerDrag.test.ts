import { documentSchema, paragraphIndents, PT_PER_CM } from "@docs/shared";
import { Node } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { clampHandle, dragLabel, formatLength, rulerIndents, setIndentTransaction, snap, snapStep } from "./rulerDrag.ts";

const text = (value: string) => ({ type: "text", text: value });
const paragraph = (value: string, attrs: Record<string, unknown> = {}) => ({ type: "paragraph", attrs, content: [text(value)] });

function stateWith(content: unknown[], from = 1, to = from): EditorState {
  const doc = Node.fromJSON(documentSchema, { type: "doc", content });
  return EditorState.create({ doc, selection: TextSelection.create(doc, from, to) });
}

const indentsOf = (state: EditorState) => {
  const result: ReturnType<typeof paragraphIndents>[] = [];
  state.doc.descendants((node) => {
    if (node.type.name === "paragraph") result.push(paragraphIndents(node.attrs));
  });
  return result;
};

describe("ruler snapping", () => {
  it("snaps to quarter centimetres or eighths of an inch", () => {
    expect(snapStep("cm")).toBeCloseTo(PT_PER_CM / 4, 6);
    expect(snapStep("in")).toBe(9);
    expect(snap(2 * PT_PER_CM + 3, "cm")).toBeCloseTo(2 * PT_PER_CM, 6);
    expect(snap(2 * PT_PER_CM + 4, "cm")).toBeCloseTo(2.25 * PT_PER_CM, 6);
    expect(snap(40, "in")).toBe(36);
    expect(snap(41, "in")).toBe(45);
    expect(snap(-5, "in")).toBe(-9);
  });

  it("labels values in the ruler's unit", () => {
    expect(formatLength(72, "cm")).toBe("2.54 cm");
    expect(formatLength(90, "in")).toBe("1.25 in");
    expect(formatLength(-0.001, "cm")).toBe("0.00 cm");
    const indents = { left: 72, firstLine: 54, right: 0 };
    expect(dragLabel("leftIndent", 72, indents, "cm")).toBe("Left indent 2.54 cm");
    // The first line indent counts from the left indent: negative when hanging.
    expect(dragLabel("firstLineIndent", 54, indents, "in")).toBe("First line indent -0.25 in");
    expect(dragLabel("marginRight", 72, indents, "in")).toBe("Right margin 1.00 in");
  });
});

describe("ruler limits", () => {
  const context = { contentWidth: 451, pageWidth: 595, margins: { left: 72, right: 72 }, indents: { left: 36, firstLine: 18, right: 0 } };

  it("keeps the indents on the page with room for text", () => {
    expect(clampHandle("firstLineIndent", -20, context)).toBe(0);
    expect(clampHandle("firstLineIndent", 1000, context)).toBe(451 - 36);
    // A hanging first line (18pt before the left indent) keeps the left indent at least 18pt in.
    expect(clampHandle("leftIndent", 0, context)).toBe(18);
    expect(clampHandle("leftIndent", 100, context)).toBe(100);
    expect(clampHandle("rightIndent", -4, context)).toBe(0);
    expect(clampHandle("rightIndent", 1000, context)).toBe(451 - 36 - 36);
  });

  it("keeps an inch between the margins", () => {
    expect(clampHandle("marginLeft", -10, context)).toBe(0);
    expect(clampHandle("marginLeft", 1000, context)).toBe(432);
    expect(clampHandle("marginRight", 1000, { ...context, margins: { left: 300, right: 72 } })).toBe(595 - 300 - 72);
  });
});

describe("setIndentTransaction", () => {
  it("sets the left indent of every selected paragraph and moves the first line with it", () => {
    const state = stateWith([paragraph("One", { indentFirstLine: 18 }), paragraph("Two", { indent: 1 }), paragraph("Three")], 2, 9);
    const next = state.apply(setIndentTransaction(state, "leftIndent", 56.69)!);
    expect(indentsOf(next)).toEqual([
      { left: 56.69, firstLine: 18, right: 0 },
      { left: 56.69, firstLine: 0, right: 0 },
      { left: 0, firstLine: 0, right: 0 },
    ]);
    // The old step count is replaced by the indent in points.
    expect(next.doc.child(1).attrs.indent).toBe(0);
  });

  it("makes a hanging indent from the first line marker", () => {
    const state = stateWith([paragraph("Hanging", { indentLeft: 36 })]);
    const next = state.apply(setIndentTransaction(state, "firstLineIndent", 0)!);
    expect(indentsOf(next)).toEqual([{ left: 36, firstLine: -36, right: 0 }]);
    expect(rulerIndents(next)).toEqual({ left: 36, firstLine: 0, right: 0 });
  });

  it("sets the right indent and does nothing when nothing changes", () => {
    const state = stateWith([paragraph("Right")]);
    const next = state.apply(setIndentTransaction(state, "rightIndent", 72)!);
    expect(indentsOf(next)).toEqual([{ left: 0, firstLine: 0, right: 72 }]);
    expect(setIndentTransaction(next, "rightIndent", 72)).toBeNull();
  });

  it("counts list levels in the ruler's left indent", () => {
    const list = {
      type: "bulletList",
      content: [{ type: "listItem", content: [paragraph("Item")] }],
    };
    const state = stateWith([list], 3);
    expect(rulerIndents(state)).toEqual({ left: 36, firstLine: 21, right: 0 });
    const next = state.apply(setIndentTransaction(state, "leftIndent", 72)!);
    // The paragraph's own indent is what the list does not already give it.
    expect(indentsOf(next)).toEqual([{ left: 36, firstLine: 0, right: 0 }]);
    expect(rulerIndents(next).left).toBe(72);
  });
});
