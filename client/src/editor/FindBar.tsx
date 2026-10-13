import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon.tsx";
import { getSearchState, goToMatch, selectCurrentMatch, setSearch } from "./search.ts";

type FindBarProps = {
  editor: Editor;
  /** Changes each time ⌘F is pressed, to take the selection as the query and refocus the field. */
  focusRequest: number;
  /** Closes the bar and opens the Find and replace dialog with the same query. */
  onMoreOptions: () => void;
  onClose: () => void;
};

/** The selected text, as a find query: short selections within one paragraph only. */
export function selectionQuery(editor: Editor): string | null {
  const { from, to, empty } = editor.state.selection;
  if (empty) return null;
  const selected = editor.state.doc.textBetween(from, to, "\n");
  return selected.length < 100 && !selected.includes("\n") ? selected : null;
}

/** "N of M" for the find field, once there is a query. */
export function useMatchCount(editor: Editor): string | null {
  return useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const { query, matches, current: index } = getSearchState(current.state);
      if (!query) return null;
      return `${matches.length === 0 ? 0 : index + 1} of ${matches.length}`;
    },
  });
}

/** Find (⌘F): a card at the top right of the editor area that highlights matches as you type. */
export function FindBar({ editor, focusRequest, onMoreOptions, onClose }: FindBarProps) {
  const [query, setQuery] = useState(() => getSearchState(editor.state).query);
  const field = useRef<HTMLInputElement>(null);
  const count = useMatchCount(editor);
  const hasMatches = useEditorState({
    editor,
    selector: ({ editor: current }) => getSearchState(current.state).matches.length > 0,
  });

  useEffect(() => {
    const selected = selectionQuery(editor);
    if (selected) setQuery(selected);
    field.current?.focus();
    field.current?.select();
  }, [editor, focusRequest]);

  useEffect(() => {
    editor.view.dispatch(setSearch(editor.state.tr, { query }));
  }, [editor, query]);

  // Remove the highlights when the bar goes away.
  useEffect(
    () => () => {
      if (!editor.isDestroyed) editor.view.dispatch(setSearch(editor.state.tr, { query: "" }));
    },
    [editor],
  );

  const go = (direction: 1 | -1) => {
    const tr = goToMatch(editor.state, direction);
    if (tr) editor.view.dispatch(tr);
  };
  const close = () => {
    const select = selectCurrentMatch(editor.state);
    if (select) editor.view.dispatch(select);
    onClose();
    editor.commands.focus();
  };

  return (
    <div className="find-bar" role="search" aria-label="Find in document">
      <label className="text-field find-field">
        <input
          ref={field}
          placeholder=" "
          aria-label="Find in document"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              go(event.shiftKey ? -1 : 1);
            }
            if (event.key === "Escape") {
              event.preventDefault();
              close();
            }
          }}
        />
        <span className="text-field-label" aria-hidden>
          Find in document
        </span>
        {count && (
          <span className="find-count" aria-live="polite">
            {count}
          </span>
        )}
      </label>
      <button
        type="button"
        className="icon-button find-button"
        aria-label="Previous"
        data-tooltip="Previous"
        disabled={!hasMatches}
        onClick={() => go(-1)}
      >
        <Icon name="keyboard_arrow_up" />
      </button>
      <button
        type="button"
        className="icon-button find-button"
        aria-label="Next"
        data-tooltip="Next"
        disabled={!hasMatches}
        onClick={() => go(1)}
      >
        <Icon name="keyboard_arrow_down" />
      </button>
      <button
        type="button"
        className="icon-button find-button"
        aria-label="More options"
        data-tooltip="More options"
        onClick={onMoreOptions}
      >
        <Icon name="more_vert" />
      </button>
      <button type="button" className="icon-button find-button" aria-label="Close" data-tooltip="Close" onClick={close}>
        <Icon name="close" />
      </button>
    </div>
  );
}
