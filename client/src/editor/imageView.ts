// A selected image shows an outline with eight handles and a rotation handle above it.
// Corner handles resize keeping the proportions, edge handles stretch one side (Shift keeps the
// proportions there too). The new size is stored on release, as one undo step.
import { DocsImage, imageSizeStyle, MIN_IMAGE_SIZE } from "@docs/shared";
import { closeHistory } from "@tiptap/pm/history";
import type { Node } from "@tiptap/pm/model";
import { NodeSelection, type EditorState } from "@tiptap/pm/state";
import type { EditorView, NodeView } from "@tiptap/pm/view";

/** Handle names and the direction each one moves the right/bottom edge: -1, 0 or 1. */
const handles = {
  nw: [-1, -1],
  n: [0, -1],
  ne: [1, -1],
  e: [1, 0],
  se: [1, 1],
  s: [0, 1],
  sw: [-1, 1],
  w: [-1, 0],
} as const;

export type ImageHandle = keyof typeof handles;

export type ImageSize = { width: number; height: number };

/**
 * The size after dragging `handle` by `dx`, `dy` CSS pixels from `start`, at most `maxWidth` wide.
 * Corners (and edges with `keepRatio`) keep the proportions.
 */
export function resizedImage(start: ImageSize, handle: ImageHandle, dx: number, dy: number, keepRatio: boolean, maxWidth: number): ImageSize {
  const [directionX, directionY] = handles[handle];
  const ratio = start.width / start.height;
  const grownWidth = start.width + dx * directionX;
  const grownHeight = start.height + dy * directionY;
  const proportional = keepRatio || (directionX !== 0 && directionY !== 0);
  let width: number;
  let height: number;
  if (proportional) {
    // The edge that moved further, relative to the image's size, decides.
    const scaleX = directionX === 0 ? null : grownWidth / start.width;
    const scaleY = directionY === 0 ? null : grownHeight / start.height;
    const scale =
      scaleX === null ? scaleY! : scaleY === null ? scaleX : Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY;
    width = start.width * scale;
    height = width / ratio;
    const smallest = Math.max(MIN_IMAGE_SIZE, MIN_IMAGE_SIZE * ratio);
    if (width < smallest) [width, height] = [smallest, smallest / ratio];
    if (width > maxWidth) [width, height] = [maxWidth, maxWidth / ratio];
  } else {
    width = Math.min(Math.max(grownWidth, MIN_IMAGE_SIZE), maxWidth);
    height = Math.max(grownHeight, MIN_IMAGE_SIZE);
  }
  return { width: Math.round(width), height: Math.round(height) };
}

class ImageView implements NodeView {
  dom: HTMLElement;
  private image: HTMLImageElement;
  private resizing = false;

  constructor(
    private node: Node,
    private view: EditorView,
    private getPos: () => number | undefined,
  ) {
    this.dom = document.createElement("div");
    this.dom.className = "image-frame";
    this.image = this.dom.appendChild(document.createElement("img"));
    this.image.draggable = false;

    const frame = this.dom.appendChild(document.createElement("div"));
    frame.className = "image-handles";
    frame.setAttribute("aria-hidden", "true");
    // Rotation is not available yet; the handle shows where it will be.
    frame.appendChild(document.createElement("div")).className = "image-rotate-stem";
    frame.appendChild(document.createElement("div")).className = "image-rotate-handle";
    for (const name of Object.keys(handles) as ImageHandle[]) {
      const handle = frame.appendChild(document.createElement("div"));
      handle.className = `image-handle image-handle-${name}`;
      handle.dataset.handle = name;
      handle.addEventListener("pointerdown", (event) => this.startResize(event, name));
      handle.addEventListener("mousedown", (event) => event.preventDefault());
    }
    // The image is draggable (to move it), but not while a handle is being dragged.
    this.dom.addEventListener("dragstart", (event) => {
      if (this.resizing) event.preventDefault();
    });
    this.render();
  }

  update(node: Node): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    if (!this.resizing) this.render();
    return true;
  }

  /** Events on the handles are the view's own; ProseMirror must not start a selection or drag. */
  stopEvent(event: Event): boolean {
    return event.target instanceof Element && event.target.closest(".image-handles") !== null;
  }

  ignoreMutation(): boolean {
    return true;
  }

  private render() {
    const { src, alt, title, width, height } = this.node.attrs;
    if (this.image.getAttribute("src") !== src) this.image.src = src ?? "";
    setAttribute(this.image, "alt", alt);
    setAttribute(this.image, "title", title);
    this.image.setAttribute("style", imageSizeStyle(width, height) ?? "");
  }

  private startResize(event: PointerEvent, handle: ImageHandle) {
    if (event.button !== 0 || !this.view.editable) return;
    event.preventDefault();
    event.stopPropagation();
    const pos = this.getPos();
    if (pos === undefined) return;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    const start = { width: this.image.offsetWidth, height: this.image.offsetHeight };
    if (!start.width || !start.height) return;
    // CSS pixels per screen pixel, under the editor's zoom.
    const scale = start.width / this.image.getBoundingClientRect().width || 1;
    const maxWidth = this.dom.parentElement?.clientWidth || Infinity;
    const [startX, startY] = [event.clientX, event.clientY];
    let size = start;
    this.resizing = true;
    this.dom.classList.add("is-resizing");

    const move = (moveEvent: PointerEvent) => {
      const dx = (moveEvent.clientX - startX) * scale;
      const dy = (moveEvent.clientY - startY) * scale;
      size = resizedImage(start, handle, dx, dy, moveEvent.shiftKey, maxWidth);
      this.image.setAttribute("style", imageSizeStyle(size.width, size.height)!);
    };
    const finish = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", finish);
      target.removeEventListener("pointercancel", finish);
      this.resizing = false;
      this.dom.classList.remove("is-resizing");
      const current = this.getPos();
      if (current === undefined || (size.width === start.width && size.height === start.height)) return this.render();
      // Each resize is an undo step of its own.
      const tr = closeHistory(this.view.state.tr).setNodeMarkup(current, undefined, { ...this.node.attrs, ...size });
      this.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, current)));
      this.view.focus();
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", finish);
    target.addEventListener("pointercancel", finish);
  }
}

function setAttribute(element: HTMLElement, name: string, value: unknown) {
  if (typeof value === "string" && value) element.setAttribute(name, value);
  else element.removeAttribute(name);
}

/** The image extension of the editor: the shared image with the node view above. */
export const EditorImage = DocsImage.extend({
  addNodeView() {
    return ({ node, view, getPos }) => new ImageView(node, view, getPos);
  },
});

/** Whether the selection is an image (clicked, or right-clicked). */
export function isImage(editor: { state: EditorState }): boolean {
  const { selection } = editor.state;
  return selection instanceof NodeSelection && selection.node.type.name === "image";
}
