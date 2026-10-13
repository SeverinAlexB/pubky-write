import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon.tsx";
import { selectionQuery, useMatchCount } from "./FindBar.tsx";
import { getSearchState, goToMatch, replaceAll, replaceCurrent, selectCurrentMatch, setSearch } from "./search.ts";

/** Edit > Find and replace (⌘⇧H). The matches stay highlighted in the document behind the scrim. */
export function FindReplaceDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState(() => selectionQuery(editor) ?? getSearchState(editor.state).query);
  const [replacement, setReplacement] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const count = useMatchCount(editor);
  const options = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const { caseSensitive, regex, ignoreDiacritics, matches } = getSearchState(current.state);
      return { caseSensitive, regex, ignoreDiacritics, hasMatches: matches.length > 0 };
    },
  });

  useEffect(() => dialog.current?.showModal(), []);

  useEffect(() => {
    editor.view.dispatch(setSearch(editor.state.tr, { query }));
  }, [editor, query]);

  useEffect(
    () => () => {
      if (!editor.isDestroyed) editor.view.dispatch(setSearch(editor.state.tr, { query: "" }));
    },
    [editor],
  );

  const run = (transaction: ReturnType<typeof goToMatch>) => {
    if (transaction) editor.view.dispatch(transaction);
  };
  const replace = () => {
    run(replaceCurrent(editor.state, replacement));
    run(selectCurrentMatch(editor.state));
  };
  const close = () => {
    run(selectCurrentMatch(editor.state));
    onClose();
  };

  return (
    <dialog
      ref={dialog}
      className="dialog find-replace-dialog"
      aria-labelledby="find-replace-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="dialog-title-row">
        <h2 id="find-replace-title">Find and replace</h2>
        <button type="button" className="icon-button" aria-label="Close" onClick={close}>
          <Icon name="close" size={24} />
        </button>
      </div>
      <label className="text-field find-field">
        <input
          autoFocus
          placeholder=" "
          aria-label="Find"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            run(goToMatch(editor.state, event.shiftKey ? -1 : 1));
          }}
        />
        <span className="text-field-label" aria-hidden>
          Find
        </span>
        {count && (
          <span className="find-count" aria-live="polite">
            {count}
          </span>
        )}
      </label>
      <label className="text-field">
        <input
          placeholder=" "
          aria-label="Replace with"
          value={replacement}
          onChange={(event) => setReplacement(event.target.value)}
        />
        <span className="text-field-label" aria-hidden>
          Replace with
        </span>
      </label>
      <div className="find-replace-options">
        <label className="checkbox-option">
          <input
            type="checkbox"
            checked={options.caseSensitive}
            onChange={(event) => editor.view.dispatch(setSearch(editor.state.tr, { caseSensitive: event.target.checked }))}
          />
          Match case
        </label>
        <div className="checkbox-row">
          <label className="checkbox-option">
            <input
              type="checkbox"
              checked={options.regex}
              onChange={(event) => editor.view.dispatch(setSearch(editor.state.tr, { regex: event.target.checked }))}
            />
            {"Use regular expressions (e.g. \\n for newline, \\t for tab)"}
          </label>
          <button type="button" className="link-button" aria-expanded={helpOpen} onClick={() => setHelpOpen((open) => !open)}>
            Help
          </button>
          {helpOpen && (
            <div className="find-help" role="note">
              The search is a JavaScript regular expression, for example <code>colou?r</code> or <code>\d+</code>. Use{" "}
              <code>\n</code> to match a line break within a paragraph. In “Replace with”, <code>$1</code> inserts the text of the
              first group in brackets and <code>$&amp;</code> the whole match.
            </div>
          )}
        </div>
        <label className="checkbox-option">
          <input
            type="checkbox"
            checked={options.ignoreDiacritics}
            onChange={(event) => editor.view.dispatch(setSearch(editor.state.tr, { ignoreDiacritics: event.target.checked }))}
          />
          Ignore diacritics (e.g. ä = a, E = É)
        </label>
      </div>
      <div className="dialog-actions">
        <button type="button" className="button-secondary" disabled={!options.hasMatches} onClick={replace}>
          Replace
        </button>
        <button
          type="button"
          className="button-secondary"
          disabled={!options.hasMatches}
          onClick={() => run(replaceAll(editor.state, replacement))}
        >
          Replace all
        </button>
        <button
          type="button"
          className="button-secondary"
          disabled={!options.hasMatches}
          onClick={() => run(goToMatch(editor.state, -1))}
        >
          Previous
        </button>
        <button
          type="button"
          className="button-primary"
          disabled={!options.hasMatches}
          onClick={() => run(goToMatch(editor.state, 1))}
        >
          Next
        </button>
      </div>
    </dialog>
  );
}
