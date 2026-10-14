// Automatic formatting while typing (Tools > Preferences): capitalisation, smart quotes,
// substitutions, links, lists and Markdown. The rules are in autoformatRules.ts.
//
// The typed character is inserted first, as ordinary typing; the automatic change follows as a
// transaction of its own that starts a new undo step. So ⌘Z right after it undoes only the
// change and leaves what was typed. In Suggesting mode both become suggestions (see
// `suggestParts` in suggesting.ts).
import { Extension } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { Mark, Node, ResolvedPos } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { findWrapping } from "@tiptap/pm/transform";
import { autoChange, OBJECT_CHAR, type AutoChange, type BlockChange } from "./autoformatRules.ts";
import { getPreferences } from "./preferences.ts";
import { suggestParts, type Part } from "./suggesting.ts";

/** Set on the transactions that make an automatic change. */
export const AUTOFORMAT = "autoformat";

/** How much text before the cursor the rules look at. */
const CONTEXT_LENGTH = 300;

/** Every rule ends with a character that is not a letter or digit; other keystrokes cost nothing. */
const TRIGGERS = /[^\p{L}\p{N}]/u;

type TextBefore = {
  text: string;
  /** The document position of each character of `text`. */
  positions: number[];
  fromStart: boolean;
};

/**
 * The paragraph's text before the cursor. Text suggested for deletion is left out, as it is not
 * part of what the user sees as the sentence; other inline content reads as one object character.
 */
function textBefore(state: EditorState, $cursor: ResolvedPos): TextBefore {
  const parent = $cursor.parent;
  const start = $cursor.start();
  const deleted = state.schema.marks.suggestionDelete;
  let text = "";
  const positions: number[] = [];
  parent.nodesBetween(0, $cursor.parentOffset, (node, offset) => {
    if (node.isText) {
      if (deleted?.isInSet(node.marks)) return false;
      const end = Math.min(node.text!.length, $cursor.parentOffset - offset);
      for (let index = 0; index < end; index++) positions.push(start + offset + index);
      text += node.text!.slice(0, end);
    } else if (node.isInline) {
      positions.push(start + offset);
      text += OBJECT_CHAR;
    }
    return false;
  });
  if (text.length <= CONTEXT_LENGTH) return { text, positions, fromStart: true };
  return { text: text.slice(-CONTEXT_LENGTH), positions: positions.slice(-CONTEXT_LENGTH), fromStart: false };
}

function hasCode(state: EditorState, $cursor: ResolvedPos): boolean {
  if ($cursor.parent.type.spec.code) return true;
  const code = state.schema.marks.code;
  return Boolean(code && code.isInSet(state.storedMarks ?? $cursor.marks()));
}

function inList($cursor: ResolvedPos): boolean {
  for (let depth = $cursor.depth - 1; depth > 0; depth--) {
    if (["listItem", "taskItem"].includes($cursor.node(depth).type.name)) return true;
  }
  return false;
}

/**
 * Finds the automatic change for typing `typed` ("" for Enter) at the cursor. Returns a function
 * that builds its transaction from the state once the typed character is in the document.
 */
export function planChange(state: EditorState, typed: string): ((state: EditorState) => Transaction | null) | null {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty) return null;
  const $cursor = selection.$from;
  if (!$cursor.parent.isTextblock || hasCode(state, $cursor)) return null;
  const before = textBefore(state, $cursor);
  const change = autoChange(before.text, typed, getPreferences(), {
    fromStart: before.fromStart,
    plainParagraph: $cursor.parent.type.name === "paragraph" && !$cursor.parent.attrs.paragraphStyle && !inList($cursor),
    atParagraphEnd: $cursor.parentOffset === $cursor.parent.content.size,
  });
  if (!change) return null;
  // Offsets in `before + typed` as positions once the typed character is inserted at the cursor.
  const at = (offset: number) => (offset < before.text.length ? before.positions[offset]! : $cursor.pos + (offset - before.text.length));
  const range = (from: number, to: number) => ({ from: at(from), to: at(to - 1) + 1 });
  return (next) => changeTransaction(next, change, range, $cursor.before());
}

function changeTransaction(
  state: EditorState,
  change: AutoChange,
  range: (from: number, to: number) => { from: number; to: number },
  blockPos: number,
): Transaction | null {
  const { schema } = state;
  const parts: Part[] = [];
  let finish: ((tr: Transaction) => void) | undefined;

  switch (change.kind) {
    case "replace": {
      const { from, to } = range(change.from, change.to);
      const marks = marksOf(state.doc.nodeAt(from));
      parts.push((tr) => tr.replaceWith(from, to, schema.text(change.text, marks)));
      break;
    }
    case "link": {
      const { from, to } = range(change.from, change.to);
      const link = schema.marks.link;
      if (!link || state.doc.rangeHasMark(from, to, link)) return null;
      parts.push((tr) => tr.addMark(from, to, link.create({ href: change.href })));
      break;
    }
    case "block": {
      const { from } = range(0, 1);
      parts.push((tr) => tr.delete(from, from + change.markerLength));
      parts.push((tr, map) => changeBlock(tr, map(blockPos), change.block));
      break;
    }
    case "mark": {
      const type = schema.marks[change.mark];
      if (!type) return null;
      const open = range(...change.open);
      const close = range(...change.close);
      parts.push((tr) => {
        tr.delete(close.from, close.to);
        tr.delete(open.from, open.to);
      });
      // In Suggesting mode the delimiters may stay (struck through), so the text is mapped.
      parts.push((tr, map) => tr.addMark(map(open.to, 1), map(close.from, -1), type.create()));
      finish = (tr) => tr.removeStoredMark(type);
      break;
    }
    case "horizontalRule": {
      const block = state.doc.nodeAt(blockPos);
      const rule = schema.nodes.horizontalRule;
      if (!block || !rule) return null;
      parts.push((tr) => {
        tr.replaceWith(blockPos, blockPos + block.nodeSize, [rule.create(), schema.nodes.paragraph!.create()]);
        tr.setSelection(TextSelection.create(tr.doc, blockPos + 2));
      });
      break;
    }
  }

  const tr = suggestParts(state, parts);
  if (!tr) return null;
  finish?.(tr);
  closeHistory(tr);
  return tr.setMeta(AUTOFORMAT, true).scrollIntoView();
}

function marksOf(node: Node | null): readonly Mark[] {
  return node?.isText ? node.marks.filter((mark) => !mark.type.name.startsWith("suggestion")) : [];
}

function changeBlock(tr: Transaction, pos: number, block: BlockChange): void {
  const { schema } = tr.doc.type;
  const node = tr.doc.nodeAt(pos);
  if (!node) return;
  const reset = { spaceBefore: null, spaceAfter: null };
  switch (block.type) {
    case "heading":
      tr.setNodeMarkup(pos, schema.nodes.heading, { ...node.attrs, ...reset, level: block.level });
      return;
    case "codeBlock":
      tr.setBlockType(pos + 1, pos + 1, schema.nodes.codeBlock!);
      return;
    case "blockquote":
    case "list": {
      const $start = tr.doc.resolve(pos + 1);
      const blockRange = $start.blockRange();
      if (!blockRange) return;
      const type = block.type === "blockquote" ? schema.nodes.blockquote! : schema.nodes[block.list === "bullet" ? "bulletList" : "orderedList"]!;
      const wrapping = findWrapping(blockRange, type, block.type === "list" ? { listPreset: block.preset } : null);
      if (wrapping) tr.wrap(blockRange, wrapping);
    }
  }
}

const autoformatKey = new PluginKey("autoformat");

export const Autoformat = Extension.create({
  name: "autoformat",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: autoformatKey,
        props: {
          handleTextInput(view, from, to, text) {
            if (text.length !== 1 || from !== to || !TRIGGERS.test(text) || view.composing) return false;
            const change = planChange(view.state, text);
            if (!change) return false;
            view.dispatch(view.state.tr.insertText(text, from, to).scrollIntoView());
            const tr = change(view.state);
            if (tr) view.dispatch(tr);
            return true;
          },
          handleKeyDown(view, event) {
            if (event.key !== "Enter" || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey || view.composing) return false;
            // Links, substitutions and capitals of the word before Enter; Enter itself goes on as usual.
            const tr = planChange(view.state, "")?.(view.state);
            if (tr) view.dispatch(tr);
            return false;
          },
        },
      }),
    ];
  },
});
