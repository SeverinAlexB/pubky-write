// The colon picker (spec 20; Tools > Preferences > "Insert emoji using the colon character"):
// typing `:` and at least two letters after a space or at the start of a paragraph shows a list of
// matching emoji under the cursor (ColonPicker.tsx). ↑ and ↓ choose, Enter or Tab inserts the
// emoji in place of what was typed, Escape or a space dismisses the list.
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { getPreferences } from "../preferences.ts";

/** The typed `:query`: from the colon to the cursor. */
export type ColonMatch = { from: number; to: number; query: string };

type ColonState = {
  match: ColonMatch | null;
  /** The highlighted entry of the list. */
  index: number;
  /** A match dismissed with Escape (by the position of its colon), until the colon goes. */
  dismissed: number | null;
};

type ColonMeta = { index: number } | { dismiss: true };

export const colonEmojiKey = new PluginKey<ColonState>("colonEmoji");

const QUERY = /(?:^|\s):(\p{L}{2}[\p{L}\p{N}_+-]*)$/u;
const CONTEXT = 40;

/** The `:query` before the cursor, if there is one to show the list for. */
function findMatch(state: EditorState): ColonMatch | null {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty || !getPreferences().emojiColon) return null;
  const { $from } = selection;
  if (!$from.parent.isTextblock || $from.parent.type.spec.code) return null;
  const start = Math.max(0, $from.parentOffset - CONTEXT);
  const text = $from.parent.textBetween(start, $from.parentOffset, undefined, "￼");
  const found = QUERY.exec(text);
  if (!found || (found.index === 0 && start > 0 && !/^\s/.test(found[0]))) return null;
  const query = found[1]!;
  return { from: $from.pos - query.length - 1, to: $from.pos, query };
}

/** The emoji the list shows for the current match, set by the list (ColonPicker.tsx). */
const shown = new WeakMap<EditorView, string[]>();

export function setColonResults(view: EditorView, emoji: string[]): void {
  shown.set(view, emoji);
}

export function colonState(state: EditorState): ColonState | null {
  return colonEmojiKey.getState(state) ?? null;
}

/** Replaces the typed `:query` with the emoji. */
export function insertColonEmoji(view: EditorView, emoji: string): void {
  const match = colonState(view.state)?.match;
  if (!match) return;
  view.dispatch(view.state.tr.insertText(emoji, match.from, match.to).scrollIntoView());
  view.focus();
}

export function setColonIndex(view: EditorView, index: number): void {
  view.dispatch(view.state.tr.setMeta(colonEmojiKey, { index } satisfies ColonMeta));
}

export const ColonEmoji = Extension.create({
  name: "colonEmoji",
  // Before the key bindings of Enter and Tab.
  priority: 900,
  addProseMirrorPlugins() {
    return [
      new Plugin<ColonState>({
        key: colonEmojiKey,
        state: {
          init: () => ({ match: null, index: 0, dismissed: null }),
          apply(tr, value, _old, state) {
            const meta = tr.getMeta(colonEmojiKey) as ColonMeta | undefined;
            if (meta && "index" in meta) return { ...value, index: meta.index };
            if (!tr.docChanged && !tr.selectionSet && !meta) return value;
            const match = findMatch(state);
            const dismissed = meta && "dismiss" in meta ? (value.match?.from ?? null) : value.dismissed;
            if (!match) return { match: null, index: 0, dismissed: null };
            if (dismissed === match.from) return { match: null, index: 0, dismissed };
            const same = value.match?.from === match.from && value.match.query === match.query;
            return { match, index: same ? value.index : 0, dismissed: null };
          },
        },
        props: {
          handleKeyDown(view, event) {
            const value = colonEmojiKey.getState(view.state);
            const results = shown.get(view) ?? [];
            if (!value?.match || results.length === 0 || event.metaKey || event.ctrlKey || event.altKey) return false;
            switch (event.key) {
              case "ArrowDown":
              case "ArrowUp": {
                const step = event.key === "ArrowDown" ? 1 : -1;
                setColonIndex(view, (value.index + step + results.length) % results.length);
                return true;
              }
              case "Enter":
              case "Tab":
                insertColonEmoji(view, results[Math.min(value.index, results.length - 1)]!);
                return true;
              case "Escape":
                view.dispatch(view.state.tr.setMeta(colonEmojiKey, { dismiss: true } satisfies ColonMeta));
                return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});
