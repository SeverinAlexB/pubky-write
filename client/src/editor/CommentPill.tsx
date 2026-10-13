// The small floating pill that offers "Add comment" just right of the end of a text selection.
import type { Editor } from "@tiptap/react";
import { useEffect, useState } from "react";
import { Icon } from "../components/Icon.tsx";
import { getCommentAnchors } from "./commentAnchors.ts";

type Position = { left: number; top: number };

/** Space between the end of the selection and the pill. */
const OFFSET = 4;

/**
 * Shown while the editor has focus and a selection with text, and no comment is being written.
 * Positions are relative to `column`, the element the pill is placed in, so it scrolls with the text.
 */
export function CommentPill({ editor, column, onAddComment }: { editor: Editor; column: HTMLElement | null; onAddComment: () => void }) {
  const [position, setPosition] = useState<Position | null>(null);

  useEffect(() => {
    if (!column) return;
    let frame = 0;
    let pointerDown = false;
    const update = () => {
      frame = 0;
      setPosition((previous) => {
        const next = pillPosition(editor, column, pointerDown);
        return next && previous && next.left === previous.left && next.top === previous.top ? previous : next;
      });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    // The pill appears once a selection made with the mouse is finished.
    const onPointerDown = () => {
      pointerDown = true;
      setPosition(null);
    };
    const onPointerUp = () => {
      pointerDown = false;
      schedule();
    };
    const hide = () => setPosition(null);
    const dom = editor.view.dom;
    editor.on("transaction", schedule);
    editor.on("focus", schedule);
    editor.on("blur", schedule);
    // Typing replaces or collapses the selection; hide right away rather than a frame later.
    dom.addEventListener("keydown", hide);
    dom.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      editor.off("transaction", schedule);
      editor.off("focus", schedule);
      editor.off("blur", schedule);
      dom.removeEventListener("keydown", hide);
      dom.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("resize", schedule);
    };
  }, [editor, column]);

  if (!position) return null;
  return (
    <div
      className="comment-pill"
      role="toolbar"
      aria-label="Selection actions"
      style={position}
      // Keep the editor's focus and selection.
      onMouseDown={(event) => event.preventDefault()}
    >
      <button type="button" className="icon-button" aria-label="Add comment" data-tooltip="Add comment" onClick={onAddComment}>
        <Icon name="add_comment" />
      </button>
      {/* Emoji reactions are P2: shown, but not available yet. */}
      <button type="button" className="icon-button" aria-label="Add emoji reaction" data-tooltip="Add emoji reaction" disabled>
        <Icon name="add_reaction" />
      </button>
    </div>
  );
}

function pillPosition(editor: Editor, column: HTMLElement, pointerDown: boolean): Position | null {
  if (editor.isDestroyed || pointerDown || !editor.view.hasFocus()) return null;
  const { state } = editor;
  const { from, to, empty } = state.selection;
  if (empty || getCommentAnchors(state).draft || !state.doc.textBetween(from, to, " ", " ").trim()) return null;
  const end = editor.view.coordsAtPos(to, -1);
  const columnRect = column.getBoundingClientRect();
  return { left: Math.round(end.right - columnRect.left + OFFSET), top: Math.round(end.bottom - columnRect.top + OFFSET) };
}
