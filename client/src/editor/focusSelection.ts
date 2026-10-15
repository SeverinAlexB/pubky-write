import { Extension, isAndroid, isiOS, isSafari, isTextSelection, resolveFocusPosition } from "@tiptap/core";

/**
 * Tiptap's `focus` command, except that in desktop Safari the selection goes into the DOM together
 * with the focus.
 *
 * Tiptap focuses the element at once in Safari and writes the selection a frame later. Safari puts
 * the caret at the start of a contenteditable element that gets the focus without a selection in
 * it (after a toolbar button, the zoom field or the comment field had it), so keys typed in that
 * frame, and the `selectionchange` of that caret, landed at the start of the document.
 * `view.focus()` focuses without scrolling and writes the selection in one go.
 */
export const FocusSelection = Extension.create({
  name: "focusSelection",
  addCommands() {
    return {
      focus:
        (position = null, options = {}) =>
        ({ editor, view, tr, dispatch }) => {
          const scrollIntoView = options.scrollIntoView ?? true;
          const delayedFocus = () => {
            if (isiOS() || isAndroid()) (view.dom as HTMLElement).focus();
            else if (isSafari()) view.focus();
            // As in Tiptap: React needs the focus asynchronously.
            requestAnimationFrame(() => {
              if (editor.isDestroyed) return;
              view.focus();
              if (scrollIntoView) editor.commands.scrollIntoView();
            });
          };
          try {
            if ((view.hasFocus() && position === null) || position === false) return true;
          } catch {
            // The view is not mounted yet.
            return false;
          }
          if (dispatch && position === null && !isTextSelection(editor.state.selection)) {
            delayedFocus();
            return true;
          }
          const selection = resolveFocusPosition(tr.doc, position) || editor.state.selection;
          const isSameSelection = editor.state.selection.eq(selection);
          if (dispatch) {
            if (!isSameSelection) tr.setSelection(selection);
            if (isSameSelection && tr.storedMarks) tr.setStoredMarks(tr.storedMarks);
            delayedFocus();
          }
          return true;
        },
    };
  },
});
