// Commands for the selected image: the pill's Wrap text options, margin and position menus, Image
// options and Replace image. Each is one undo step and keeps the image selected.
import { imageLayoutOf, pageGeometry, pageSetupOf, type ImagePositioning, type ImageWrap } from "@pubky-write/shared";
import { closeHistory } from "./tabHistory.ts";
import { NodeSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { paginationKey, PAGE_GAP } from "./pagination.ts";
import { clientRect } from "./rects.ts";

/** The selected image and its position, or null. */
export function selectedImage(view: EditorView): { pos: number; attrs: Record<string, unknown> } | null {
  const { selection } = view.state;
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== "image") return null;
  return { pos: selection.from, attrs: selection.node.attrs };
}

/**
 * Changes attributes of the selected image. Changes within `mergeWithin` milliseconds of each
 * other (a slider being dragged) are one undo step; otherwise each change is its own.
 */
export function setImageAttributes(view: EditorView, attrs: Record<string, unknown>, merge = false): boolean {
  const image = selectedImage(view);
  if (!image) return false;
  const tr = view.state.tr;
  if (!merge) closeHistory(tr);
  tr.setNodeMarkup(image.pos, undefined, { ...image.attrs, ...attrs });
  view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, image.pos)));
  return true;
}

/** Wrap text options: the image keeps its place on the page where it can. */
export function setImageWrap(view: EditorView, wrap: ImageWrap): boolean {
  const image = selectedImage(view);
  if (!image) return false;
  const layout = imageLayoutOf(image.attrs);
  if (layout.wrap === wrap) return true;
  const attrs: Record<string, unknown> = { wrap };
  if (wrap === "inline") Object.assign(attrs, { positioning: "moveWithText", offsetX: 0, offsetY: 0 });
  else if (layout.wrap === "inline") Object.assign(attrs, { offsetX: 0, offsetY: 0 });
  // A placed image keeps the size it has on the page, so the layout does not depend on loading it.
  if (wrap !== "inline" && !(typeof image.attrs.width === "number" && typeof image.attrs.height === "number")) {
    const frame = view.nodeDOM(image.pos);
    const picture = frame instanceof HTMLElement ? frame.querySelector("img") : null;
    if (picture?.offsetWidth && picture.offsetHeight) Object.assign(attrs, { width: picture.offsetWidth, height: picture.offsetHeight });
  }
  return setImageAttributes(view, attrs);
}

/**
 * Move with text or Fix position on page. The offsets are measured again from the new reference
 * (the anchor paragraph or the page), so the image does not move.
 */
export function setImagePositioning(view: EditorView, positioning: ImagePositioning): boolean {
  const image = selectedImage(view);
  if (!image) return false;
  const layout = imageLayoutOf(image.attrs);
  if (layout.positioning === positioning) return true;
  const frame = view.nodeDOM(image.pos);
  const stack = frame instanceof HTMLElement ? frame.closest<HTMLElement>(".page-stack") : null;
  if (!(frame instanceof HTMLElement) || !stack) return setImageAttributes(view, { positioning });
  const scale = stack.offsetWidth / stack.getBoundingClientRect().width || 1;
  const rect = clientRect(frame);
  // The unrotated top left corner: rotation keeps the centre.
  const left = rect.left + rect.width / 2 - frame.offsetWidth / scale / 2;
  const top = rect.top + rect.height / 2 - frame.offsetHeight / scale / 2;
  let offsets: { offsetX: number; offsetY: number };
  if (positioning === "fixed") {
    const stackRect = stack.getBoundingClientRect();
    const stride = pageGeometry(pageSetupOf(view.state.doc)).height + (paginationKey.getState(view.state)?.gap ?? PAGE_GAP);
    const y = (top - stackRect.top) * scale;
    const page = Math.max(0, Math.floor(y / stride));
    // Wrapped and breaking images stay in their column: only behind and in front of text are
    // placed from the page's left edge.
    const free = layout.wrap === "behind" || layout.wrap === "front";
    offsets = { offsetX: free ? round((left - stackRect.left) * scale) : layout.offsetX, offsetY: round(y - page * stride) };
  } else {
    // Relative to the block after the image (its anchor), as Move with text measures.
    let anchor = frame.nextElementSibling;
    while (anchor?.matches(".page-spacer, .column-spacer, .table-page-spacer")) anchor = anchor.nextElementSibling;
    const anchorRect = (anchor ?? frame.parentElement!).getBoundingClientRect();
    const free = layout.wrap === "behind" || layout.wrap === "front";
    // A breaking image is in the flow: its offset is from where it starts, below its margin.
    const offsetY =
      layout.wrap === "break"
        ? (Number.parseFloat(getComputedStyle(frame).marginTop) || 0) - layout.wrapMargin * (96 / 72)
        : (top - anchorRect.top) * scale;
    const offsetX = free ? (left - anchorRect.left) * scale : layout.offsetX;
    offsets = { offsetX: round(free ? offsetX : Math.max(0, offsetX)), offsetY: round(free ? offsetY : Math.max(0, offsetY)) };
  }
  return setImageAttributes(view, { positioning, ...offsets });
}

/** Replace image: a new picture with the same size and settings. */
export function replaceImageSource(view: EditorView, pos: number, src: string): boolean {
  const node = view.state.doc.nodeAt(pos);
  if (node?.type.name !== "image") return false;
  const tr = closeHistory(view.state.tr).setNodeMarkup(pos, undefined, { ...node.attrs, src });
  view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)));
  return true;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
