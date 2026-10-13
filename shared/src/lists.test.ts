import { Node } from "@tiptap/pm/model";
import { AllSelection, TextSelection, type Selection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import {
  bulletPresets,
  formatListNumber,
  listNumberLabel,
  listPresetAt,
  listPresetIndex,
  numberedPresets,
} from "./lists.ts";
import { documentSchema } from "./schema.ts";

describe("listPresetIndex", () => {
  it("reads preset ids", () => {
    expect(listPresetIndex("bulletList", "shadowed-square")).toBe(2);
    expect(listPresetIndex("orderedList", "zero-padded")).toBe(5);
    expect(listPresetIndex("taskList", "strike-through")).toBe(1);
    expect(listPresetIndex("bulletList", "unknown")).toBe(0);
  });

  it("maps numbers stored in the old menu order to the same glyphs and numbering", () => {
    const glyphs = (value: number) => bulletPresets[listPresetIndex("bulletList", value)]!.glyphs.join(" ");
    expect([0, 1, 2, 3].map(glyphs)).toEqual(["● ○ ■", "❖ ➢ ■", "➔ ◆ ●", "★ ○ ■"]);

    const numbering = (value: number) => numberedPresets[listPresetIndex("orderedList", value)]!.label;
    expect([0, 1, 2, 3].map(numbering)).toEqual(["1. a. i.", "A. a. i.", "1) a) i)", "1. 1.1. 1.1.1."]);

    expect(listPresetIndex("taskList", 1)).toBe(1);
    expect(listPresetIndex("orderedList", 7)).toBe(0);
    expect(listPresetIndex("orderedList", null)).toBe(0);
  });

  it("finds the preset of the outermost list in the selection", () => {
    const doc = Node.fromJSON(documentSchema, {
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: { listPreset: 1 },
          content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Old" }] }] }],
        },
      ],
    });
    // Old documents keep their numbering: 1 was A. a. i., now fourth in the menu.
    const state = (selection: Selection) => ({ doc, selection });
    expect(listPresetAt(state(TextSelection.create(doc, 3)), "numbered")).toBe(3);
    expect(listPresetAt(state(TextSelection.create(doc, 3)), "bullet")).toBeNull();
    // Also with the whole document selected.
    expect(listPresetAt(state(new AllSelection(doc)), "numbered")).toBe(3);
  });
});

describe("list numbering", () => {
  it("formats numbers like CSS counter styles", () => {
    expect(formatListNumber("decimal-leading-zero", 3)).toBe("03");
    expect(formatListNumber("decimal-leading-zero", 12)).toBe("12");
    expect(formatListNumber("lower-alpha", 27)).toBe("aa");
    expect(formatListNumber("upper-roman", 14)).toBe("XIV");
    expect(formatListNumber("lower-roman", 4)).toBe("iv");
  });

  it("labels items of each numbered preset by their level", () => {
    const lines = [[1], [1, 1], [1, 2], [1, 2, 1], [2]];
    const preview = (index: number) => lines.map((path) => listNumberLabel(numberedPresets[index]!, path));
    expect(preview(0)).toEqual(["1.", "a.", "b.", "i.", "2."]);
    expect(preview(1)).toEqual(["1)", "a)", "b)", "i)", "2)"]);
    expect(preview(2)).toEqual(["1.", "1.1.", "1.2.", "1.2.1.", "2."]);
    expect(preview(3)).toEqual(["A.", "a.", "b.", "i.", "B."]);
    expect(preview(4)).toEqual(["I.", "A.", "B.", "1.", "II."]);
    expect(preview(5)).toEqual(["01.", "a.", "b.", "i.", "02."]);
  });
});
