import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getSearchState, goToMatch, replaceAll, replaceCurrent, setSearch } from "./search.ts";

type FindBarProps = {
  editor: Editor;
  showReplace: boolean;
  /** Changes each time ⌘F or ⌘⇧H is pressed, to refocus the search field. */
  focusRequest: number;
  onClose: () => void;
};

/** Find (⌘F) and find-and-replace (⌘⇧H), shown at the top right of the page. */
export function FindBar({ editor, showReplace: initialShowReplace, focusRequest, onClose }: FindBarProps) {
  const [query, setQuery] = useState(() => {
    const { from, to } = editor.state.selection;
    const selected = editor.state.doc.textBetween(from, to, " ");
    return selected.length > 0 && selected.length < 100 ? selected : getSearchState(editor.state).query;
  });
  const [replacement, setReplacement] = useState("");
  const [showReplace, setShowReplace] = useState(initialShowReplace);
  const findInput = useRef<HTMLInputElement>(null);
  const search = useEditorState({
    editor,
    selector: ({ editor }) => {
      const { matches, current, caseSensitive } = getSearchState(editor.state);
      return { count: matches.length, current, caseSensitive };
    },
  });

  useEffect(() => {
    if (initialShowReplace) setShowReplace(true);
    findInput.current?.focus();
    findInput.current?.select();
  }, [focusRequest, initialShowReplace]);

  useEffect(() => {
    editor.view.dispatch(setSearch(editor.state.tr, { query }));
  }, [editor, query]);

  // Clear the highlights when the bar closes.
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
  const apply = (build: typeof replaceCurrent) => {
    const tr = build(editor.state, replacement);
    if (tr) editor.view.dispatch(tr);
  };
  const close = () => {
    onClose();
    editor.commands.focus();
  };

  return (
    <div className="find-bar" role="search" aria-label="Find in document">
      <div className="find-row">
        <input
          ref={findInput}
          className="find-input"
          aria-label="Find in document"
          placeholder="Find in document"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") go(event.shiftKey ? -1 : 1);
            if (event.key === "Escape") close();
          }}
        />
        <span className="find-count" aria-live="polite">
          {query ? `${search.count === 0 ? 0 : search.current + 1} of ${search.count}` : ""}
        </span>
        <button type="button" className="icon-button small" aria-label="Previous match" disabled={search.count === 0} onClick={() => go(-1)}>
          <ChevronUp size={18} />
        </button>
        <button type="button" className="icon-button small" aria-label="Next match" disabled={search.count === 0} onClick={() => go(1)}>
          <ChevronDown size={18} />
        </button>
        <button type="button" className="icon-button small" aria-label="Close find" onClick={close}>
          <X size={18} />
        </button>
      </div>
      <div className="find-options">
        <label>
          <input
            type="checkbox"
            checked={search.caseSensitive}
            onChange={(event) =>
              editor.view.dispatch(setSearch(editor.state.tr, { caseSensitive: event.target.checked }))
            }
          />
          Match case
        </label>
        {!showReplace && (
          <button type="button" className="link-button" onClick={() => setShowReplace(true)}>
            Replace…
          </button>
        )}
      </div>
      {showReplace && (
        <div className="find-row">
          <input
            className="find-input"
            aria-label="Replace with"
            placeholder="Replace with"
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") apply(replaceCurrent);
              if (event.key === "Escape") close();
            }}
          />
          <button type="button" className="button-secondary small" disabled={search.count === 0} onClick={() => apply(replaceCurrent)}>
            Replace
          </button>
          <button type="button" className="button-secondary small" disabled={search.count === 0} onClick={() => apply(replaceAll)}>
            Replace all
          </button>
        </div>
      )}
    </div>
  );
}
