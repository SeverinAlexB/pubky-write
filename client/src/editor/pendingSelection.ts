import type { EditorView } from "@tiptap/pm/view";

/**
 * ProseMirror reads browser selection changes asynchronously; its DOM observer's flush applies
 * any pending one now. Call it before dispatching a transaction that does not come from the
 * user's input: if that transaction redraws part of the document, ProseMirror writes its own
 * selection back to the DOM, and a caret move or Shift+Arrow the browser has just made would be
 * undone. The observer is not part of the public API, so this is a no-op if it changes (and for
 * targets that are not views).
 */
export function flushPendingSelection(view: EditorView | object): void {
  const observer = (view as { domObserver?: { flush?: () => void } }).domObserver;
  observer?.flush?.();
}
