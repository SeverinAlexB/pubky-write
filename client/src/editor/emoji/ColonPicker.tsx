// The colon picker's list (see colonEmoji.ts): up to eight emoji matching the typed `:query`, with
// their names, under the cursor; the highlighted one is inserted by Enter or Tab.
import { useEditorState, type Editor } from "@tiptap/react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { colonState, insertColonEmoji, setColonIndex, setColonResults } from "./colonEmoji.ts";
import { loadedEmoji, loadEmoji, searchEmoji, type EmojiCategory } from "./emojiData.ts";

const MAX_RESULTS = 8;

export function ColonPicker({ editor }: { editor: Editor }) {
  const match = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const state = colonState(current.state);
      return state?.match ? { ...state.match, index: state.index } : null;
    },
    equalityFn: (a, b) => a === b || (!!a && !!b && a.from === b.from && a.to === b.to && a.query === b.query && a.index === b.index),
  });
  const [categories, setCategories] = useState<EmojiCategory[] | null>(loadedEmoji);
  const active = match !== null;
  useEffect(() => {
    if (active && !categories) loadEmoji().then(setCategories, () => {});
  }, [active, categories]);

  const results = match && categories ? searchEmoji(categories, match.query, MAX_RESULTS) : [];
  const key = results.map((result) => result.emoji).join(" ");
  useEffect(() => {
    if (!editor.isDestroyed) setColonResults(editor.view, key ? key.split(" ") : []);
  }, [editor, key]);

  if (!match || results.length === 0 || editor.isDestroyed) return null;
  let place: { left: number; top: number };
  try {
    const coords = editor.view.coordsAtPos(match.to);
    place = { left: coords.left, top: coords.bottom + 4 };
  } catch {
    return null;
  }
  const index = Math.min(match.index, results.length - 1);
  return createPortal(
    <ul className="colon-picker" role="listbox" aria-label="Emoji suggestions" style={place}>
      {results.map((result, at) => (
        <li
          key={result.emoji}
          role="option"
          aria-selected={at === index}
          className={at === index ? "is-highlighted" : undefined}
          // Keep the editor's focus and selection.
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => setColonIndex(editor.view, at)}
          onClick={() => insertColonEmoji(editor.view, result.emoji)}
        >
          <span className="colon-picker-emoji">{result.emoji}</span>
          <span className="colon-picker-name">{result.name}</span>
        </li>
      ))}
    </ul>,
    document.body,
  );
}
