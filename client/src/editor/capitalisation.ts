// Format > Text > Capitalisation: changes the selected characters themselves, keeping their
// formatting, in one undo step.
import type { Mark } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import type { Capitalisation } from "./actions.ts";

const wordCharacter = /[\p{L}\p{N}'’]/u;

/** Changes the case of `text`; `previous` is the character before it, which decides whether a word starts. */
export function changeCase(text: string, capitalisation: Capitalisation, previous = ""): string {
  if (capitalisation === "lowercase") return text.toLowerCase();
  if (capitalisation === "uppercase") return text.toUpperCase();
  let result = "";
  let before = previous;
  for (const character of text) {
    const startsWord = !wordCharacter.test(before);
    result += startsWord ? character.toUpperCase() : character.toLowerCase();
    before = character;
  }
  return result;
}

/** A transaction that changes the case of the selected text, or null when nothing would change. */
export function capitaliseSelection(state: EditorState, capitalisation: Capitalisation): Transaction | null {
  const { from, to, empty } = state.selection;
  if (empty) return null;

  const replacements: { from: number; to: number; text: string; marks: readonly Mark[] }[] = [];
  let previous = "";
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isTextblock) {
      // Title Case needs to know whether the selection starts in the middle of a word.
      const start = Math.max(from, pos + 1);
      previous = state.doc.textBetween(pos + 1, start, undefined, " ").slice(-1);
      return true;
    }
    if (!node.isText) {
      if (node.isInline) previous = " ";
      return true;
    }
    const start = Math.max(from, pos);
    const end = Math.min(to, pos + node.nodeSize);
    const original = node.text!.slice(start - pos, end - pos);
    const changed = changeCase(original, capitalisation, previous);
    previous = original.slice(-1);
    if (changed !== original) replacements.push({ from: start, to: end, text: changed, marks: node.marks });
    return false;
  });
  if (replacements.length === 0) return null;

  const tr = state.tr;
  for (const replacement of replacements.reverse()) {
    tr.replaceWith(replacement.from, replacement.to, state.schema.text(replacement.text, replacement.marks));
  }
  // Its own undo step, even right after typing.
  return closeHistory(tr).setSelection(TextSelection.create(tr.doc, tr.mapping.map(from, -1), tr.mapping.map(to, 1)));
}
