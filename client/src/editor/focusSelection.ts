import { Extension, isAndroid, isiOS, isSafari, isTextSelection, resolveFocusPosition } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { flushPendingSelection } from "./pendingSelection.ts";

/** How long after the focus ProseMirror checks the browser's selection (its focus handler). */
const PROSEMIRROR_FOCUS_CHECK_MS = 20;

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
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            // A moment after the editor gets the focus, ProseMirror writes its selection back to
            // the DOM if the browser's differs from the one it last read, to undo a caret the
            // browser placed on focus. When that timer runs late, keys pressed since then (a
            // Shift+Arrow whose selectionchange has not been read yet) were undone. If a key was
            // pressed, read the browser's selection just before: this timer is set first, so it
            // runs first.
            focus(view) {
              if ((view as unknown as { focused: boolean }).focused) return false;
              let pressed = false;
              const onKeyDown = () => {
                pressed = true;
              };
              view.dom.addEventListener("keydown", onKeyDown, true);
              setTimeout(() => {
                view.dom.removeEventListener("keydown", onKeyDown, true);
                if (pressed && !view.isDestroyed) flushPendingSelection(view);
              }, PROSEMIRROR_FOCUS_CHECK_MS);
              return false;
            },
          },
        },
      }),
    ];
  },
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
