import { documentSchema } from "@docs/shared";
import { Node } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { capitaliseSelection, changeCase } from "./capitalisation.ts";

describe("changeCase", () => {
  it("converts to lowercase, UPPERCASE and Title Case", () => {
    expect(changeCase("Hello WORLD", "lowercase")).toBe("hello world");
    expect(changeCase("Hello world", "uppercase")).toBe("HELLO WORLD");
    expect(changeCase("the QUICK brown-fox's tale", "titleCase")).toBe("The Quick Brown-Fox's Tale");
  });

  it("continues a word that started before the text", () => {
    expect(changeCase("LLO world", "titleCase", "e")).toBe("llo World");
    expect(changeCase("llo", "titleCase", " ")).toBe("Llo");
  });
});

describe("capitaliseSelection", () => {
  const doc = Node.fromJSON(documentSchema, {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "make " },
          { type: "text", text: "this", marks: [{ type: "bold" }] },
          { type: "text", text: " title" },
        ],
      },
      { type: "paragraph", content: [{ type: "text", text: "second line" }] },
    ],
  });

  it("changes the characters of the selection in one transaction and keeps marks", () => {
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 1, doc.content.size - 1) });
    const transaction = capitaliseSelection(state, "titleCase")!;
    const result = transaction.doc;

    expect(result.child(0).textContent).toBe("Make This Title");
    expect(result.child(1).textContent).toBe("Second Line");
    expect(result.child(0).child(1).text).toBe("This");
    expect(result.child(0).child(1).marks.map((mark) => mark.type.name)).toEqual(["bold"]);
    expect(transaction.selection.from).toBe(1);
    expect(transaction.selection.to).toBe(result.content.size - 1);
  });

  it("only changes the selected part of a word", () => {
    // Select "ke th" across the bold boundary.
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 3, 8) });
    expect(capitaliseSelection(state, "uppercase")!.doc.child(0).textContent).toBe("maKE THis title");
    expect(capitaliseSelection(state, "titleCase")!.doc.child(0).textContent).toBe("make This title");
  });

  it("does nothing without a selection or when nothing changes", () => {
    expect(capitaliseSelection(EditorState.create({ doc }), "uppercase")).toBeNull();
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 1, 5) });
    expect(capitaliseSelection(state, "lowercase")).toBeNull();
  });
});
