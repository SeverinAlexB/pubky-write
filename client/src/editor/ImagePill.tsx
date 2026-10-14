// The floating pill 8px below a selected image's bottom-left corner: Wrap text options, and for
// images that are not in line with text the margin and position menus, then Image options and Add
// comment.
import {
  imageLayoutOf,
  imageMarginLabel,
  imageMarginPresets,
  MAX_IMAGE_MARGIN_PT,
  type ImageLayout,
  type ImagePositioning,
  type ImageWrap,
} from "@docs/shared";
import { NodeSelection } from "@tiptap/pm/state";
import { useEditorState, type Editor } from "@tiptap/react";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "../components/Icon.tsx";
import { Menu } from "../components/Menu.tsx";
import { PromptDialog } from "../components/PromptDialog.tsx";
import { setImageAttributes, setImagePositioning, setImageWrap } from "./imageCommands.ts";
import { croppingImage, isImage } from "./imageView.ts";

type Position = { left: number; top: number };

/** Space between the image and the pill. */
const OFFSET = 8;

export const wrapOptions: { wrap: ImageWrap; label: string; icon: IconName }[] = [
  { wrap: "inline", label: "In line", icon: "format_image_inline_left" },
  { wrap: "wrap", label: "Wrap text", icon: "format_image_left" },
  { wrap: "break", label: "Break text", icon: "format_image_break_left" },
  { wrap: "behind", label: "Behind text", icon: "format_image_back" },
  { wrap: "front", label: "In front of text", icon: "format_image_front" },
];

export const positionOptions: { positioning: ImagePositioning; label: string }[] = [
  { positioning: "moveWithText", label: "Move with text" },
  { positioning: "fixed", label: "Fix position on page" },
];

type ImagePillProps = {
  editor: Editor;
  /** The element the pill is placed in, so it scrolls with the image. */
  column: HTMLElement | null;
  onImageOptions: () => void;
  onAddComment: () => void;
};

function selectLayout({ editor }: { editor: Editor }): ImageLayout | null {
  const { selection } = editor.state;
  return selection instanceof NodeSelection && selection.node.type.name === "image" ? imageLayoutOf(selection.node.attrs) : null;
}

export function ImagePill({ editor, column, onImageOptions, onAddComment }: ImagePillProps) {
  const [position, setPosition] = useState<Position | null>(null);
  const [customMargin, setCustomMargin] = useState(false);
  const layout = useEditorState({ editor, selector: selectLayout, equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b) });

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

  if (customMargin) {
    return (
      <PromptDialog
        title="Custom margin"
        label="Margin (mm)"
        initialValue={layout ? String(Math.round(((layout.wrapMargin * 25.4) / 72) * 10) / 10) : "3.2"}
        confirmLabel="Apply"
        onConfirm={(value) => {
          setCustomMargin(false);
          const mm = Number(value.replace(",", "."));
          if (Number.isFinite(mm) && mm >= 0) {
            setImageAttributes(editor.view, { wrapMargin: Math.min(Math.round(((mm * 72) / 25.4) * 100) / 100, MAX_IMAGE_MARGIN_PT) });
          }
          editor.commands.focus();
        }}
        onCancel={() => {
          setCustomMargin(false);
          editor.commands.focus();
        }}
      />
    );
  }
  if (!position || !layout) return null;
  const current = wrapOptions.find((option) => option.wrap === layout.wrap)!;
  const run = (command: () => void) => () => {
    command();
    editor.commands.focus();
  };
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
            <Icon name={current.icon} />
            <Icon name="arrow_drop_down" size={16} />
          </>
        }
        ariaLabel="Wrap text options"
        buttonClassName="icon-button image-pill-wrap"
        entries={wrapOptions.map(({ wrap, label, icon }) => ({
          label,
          icon,
          checked: wrap === layout.wrap,
          onSelect: run(() => setImageWrap(editor.view, wrap)),
        }))}
      />
      {layout.wrap !== "inline" && (
        <>
          <Menu
            label={
              <>
                <span>{imageMarginLabel(layout.wrapMargin)}</span>
                <Icon name="arrow_drop_down" size={16} />
              </>
            }
            ariaLabel="Margin"
            buttonClassName="image-pill-text"
            entries={[
              ...imageMarginPresets.map((points) => ({
                label: imageMarginLabel(points).replace(" margin", ""),
                checked: Math.abs(points - layout.wrapMargin) < 0.01,
                onSelect: run(() => setImageAttributes(editor.view, { wrapMargin: points })),
              })),
              "separator" as const,
              {
                label: "Custom…",
                checked: !imageMarginPresets.some((points) => Math.abs(points - layout.wrapMargin) < 0.01),
                onSelect: () => setCustomMargin(true),
              },
            ]}
          />
          <Menu
            label={
              <>
                <span>{positionOptions.find((option) => option.positioning === layout.positioning)!.label}</span>
                <Icon name="arrow_drop_down" size={16} />
              </>
            }
            ariaLabel="Position"
            buttonClassName="image-pill-text"
            entries={positionOptions.map(({ positioning, label }) => ({
              label,
              checked: positioning === layout.positioning,
              onSelect: run(() => setImagePositioning(editor.view, positioning)),
            }))}
          />
        </>
      )}
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
  if (editor.isDestroyed || !editor.view.hasFocus() || !isImage(editor) || croppingImage(editor.state) !== null) return null;
  const element = editor.view.nodeDOM(editor.state.selection.from);
  if (!(element instanceof HTMLElement)) return null;
  // Below the image as drawn (a rotated image's bounding box).
  const rect = element.getBoundingClientRect();
  const columnRect = column.getBoundingClientRect();
  return { left: Math.round(rect.left - columnRect.left), top: Math.round(rect.bottom - columnRect.top + OFFSET) };
}
