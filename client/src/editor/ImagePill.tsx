// The floating pill 8px below a selected image's bottom-left corner.
import type { Editor } from "@tiptap/react";
import { useEffect, useState } from "react";
import { Icon } from "../components/Icon.tsx";
import { Menu } from "../components/Menu.tsx";
import { isImage } from "./imageView.ts";

type Position = { left: number; top: number };

/** Space between the image and the pill. */
const OFFSET = 8;

type ImagePillProps = {
  editor: Editor;
  /** The element the pill is placed in, so it scrolls with the image. */
  column: HTMLElement | null;
  onImageOptions: () => void;
  onAddComment: () => void;
};

export function ImagePill({ editor, column, onImageOptions, onAddComment }: ImagePillProps) {
  const [position, setPosition] = useState<Position | null>(null);

  useEffect(() => {
    if (!column) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      setPosition((previous) => {
        const next = pillPosition(editor, column);
        return next && previous && next.left === previous.left && next.top === previous.top ? previous : next;
      });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    editor.on("transaction", schedule);
    editor.on("focus", schedule);
    editor.on("blur", schedule);
    window.addEventListener("resize", schedule);
    // Resizing with the handles moves the image's bottom edge.
    window.addEventListener("pointermove", schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      editor.off("transaction", schedule);
      editor.off("focus", schedule);
      editor.off("blur", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("pointermove", schedule);
    };
  }, [editor, column]);

  if (!position) return null;
  return (
    <div
      className="image-pill"
      role="toolbar"
      aria-label="Image actions"
      style={position}
      // Keep the editor's focus and the image selected.
      onMouseDown={(event) => event.preventDefault()}
    >
      <Menu
        label={
          <>
            <Icon name="format_image_inline_left" />
            <Icon name="arrow_drop_down" size={16} />
          </>
        }
        ariaLabel="Wrap text options"
        buttonClassName="icon-button image-pill-wrap"
        entries={[
          { label: "In line with text", icon: "format_image_inline_left", checked: true, onSelect: () => editor.commands.focus() },
          // Wrapping and breaking text around images are not available yet.
          { label: "Wrap text", icon: "wrap_text", disabled: true },
          { label: "Break text", icon: "format_image_break_left", disabled: true },
        ]}
      />
      <button type="button" className="icon-button" aria-label="Image options" data-tooltip="Image options" onClick={onImageOptions}>
        <Icon name="imagesmode" />
      </button>
      <button type="button" className="icon-button" aria-label="Add comment" data-tooltip="Add comment" onClick={onAddComment}>
        <Icon name="add_comment" />
      </button>
      <button type="button" className="icon-button" aria-label="Add emoji reaction" data-tooltip="Add emoji reaction" disabled>
        <Icon name="add_reaction" />
      </button>
    </div>
  );
}

function pillPosition(editor: Editor, column: HTMLElement): Position | null {
  if (editor.isDestroyed || !editor.view.hasFocus() || !isImage(editor)) return null;
  const element = editor.view.nodeDOM(editor.state.selection.from);
  const image = element instanceof HTMLElement ? (element.querySelector("img") ?? element) : null;
  if (!image) return null;
  const rect = image.getBoundingClientRect();
  const columnRect = column.getBoundingClientRect();
  return { left: Math.round(rect.left - columnRect.left), top: Math.round(rect.bottom - columnRect.top + OFFSET) };
}
