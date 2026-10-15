// A selected image shows an outline with eight handles and a rotation handle above it.
// Corner handles resize keeping the proportions, edge handles stretch one side (Shift keeps the
// proportions there too); the rotation handle turns the image (Shift snaps to 15°). Images that are
// not in line with text are dragged to a new place. Crop image (or a double-click) shows crop
// handles. Every change is stored on release, as one undo step. See docs/design/images.md.
import {
  croppedImageStyle,
  DocsImage,
  imageFilterStyle,
  imageFrameStyle,
  imageLayoutOf,
  imageSizeStyle,
  MIN_CROP_VISIBLE,
  MIN_IMAGE_SIZE,
  normalizeRotation,
  pageGeometry,
  pageSetupOf,
  wrapSide,
  type ImageCrop,
  type ImageLayout,
} from "@docs/shared";
import { Extension } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { Node } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView, type NodeView } from "@tiptap/pm/view";
import { currentTab } from "./documentTabs.ts";
import { PENDING_IMAGE } from "./paste.ts";
import { paginationKey, PAGE_GAP } from "./pagination.ts";
import { clientRect } from "./rects.ts";

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

/** The placeholder of a pasted image of unknown size. */
const PLACEHOLDER_SIZE: ImageSize = { width: 240, height: 160 };
/** How far the pointer moves before pressing on an image starts dragging it. */
const DRAG_THRESHOLD = 4;
/** Shift snaps the rotation to multiples of this angle. */
export const ROTATION_SNAP = 15;

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

/**
 * The rotation for the pointer at `dx`, `dy` from the image's centre: the handle is above the
 * centre, so straight up is 0°. With `snap` it goes to the nearest multiple of 15°.
 */
export function rotationAt(dx: number, dy: number, snap: boolean): number {
  const degrees = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
  return normalizeRotation(snap ? Math.round(degrees / ROTATION_SNAP) * ROTATION_SNAP : degrees);
}

/**
 * The crop after dragging the crop handle `handle` by `dx`, `dy` CSS pixels on an image whose whole
 * (uncropped) size is `full`. Each edge stays within the image and leaves some of it visible.
 */
export function croppedBy(start: ImageCrop, handle: ImageHandle, dx: number, dy: number, full: ImageSize): ImageCrop {
  const [directionX, directionY] = handles[handle];
  const crop = { ...start };
  const fractionX = dx / full.width;
  const fractionY = dy / full.height;
  const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max);
  if (directionX === -1) crop.left = clamp(start.left + fractionX, 1 - MIN_CROP_VISIBLE - start.right);
  if (directionX === 1) crop.right = clamp(start.right - fractionX, 1 - MIN_CROP_VISIBLE - start.left);
  if (directionY === -1) crop.top = clamp(start.top + fractionY, 1 - MIN_CROP_VISIBLE - start.bottom);
  if (directionY === 1) crop.bottom = clamp(start.bottom - fractionY, 1 - MIN_CROP_VISIBLE - start.top);
  const round = (value: number) => Math.round(value * 10000) / 10000;
  return { top: round(crop.top), right: round(crop.right), bottom: round(crop.bottom), left: round(crop.left) };
}

const NO_CROP: ImageCrop = { top: 0, right: 0, bottom: 0, left: 0 };

/** CSS pixels per screen pixel, under the editor's zoom. */
function zoomOf(element: HTMLElement): number {
  const zoom = (element as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom;
  return typeof zoom === "number" && zoom > 0 ? 1 / zoom : 1;
}

/** The screen rectangle of an element without its rotation (rotation keeps the centre). */
function unrotatedRect(element: HTMLElement): { left: number; top: number; width: number; height: number } {
  const rect = clientRect(element);
  const zoom = 1 / zoomOf(element);
  const width = element.offsetWidth * zoom;
  const height = element.offsetHeight * zoom;
  return { left: rect.left + rect.width / 2 - width / 2, top: rect.top + rect.height / 2 - height / 2, width, height };
}

class ImageView implements NodeView {
  dom: HTMLElement;
  private cropBox: HTMLElement;
  private image: HTMLImageElement;
  private cropUi: HTMLElement | null = null;
  private busy = false;
  private cropping: { crop: ImageCrop; start: ImageCrop; full: ImageSize; shown: ImageSize } | null = null;

  constructor(
    private node: Node,
    private view: EditorView,
    private getPos: () => number | undefined,
  ) {
    this.dom = document.createElement("div");
    this.dom.className = "image-frame";
    this.cropBox = this.dom.appendChild(document.createElement("div"));
    this.cropBox.className = "image-crop";
    this.image = this.cropBox.appendChild(document.createElement("img"));
    this.image.draggable = false;

    const frame = this.dom.appendChild(document.createElement("div"));
    frame.className = "image-handles";
    frame.setAttribute("aria-hidden", "true");
    frame.appendChild(document.createElement("div")).className = "image-rotate-stem";
    const rotate = frame.appendChild(document.createElement("div"));
    rotate.className = "image-rotate-handle";
    rotate.addEventListener("pointerdown", (event) => this.startRotate(event));
    rotate.addEventListener("mousedown", (event) => event.preventDefault());
    for (const name of Object.keys(handles) as ImageHandle[]) {
      const handle = frame.appendChild(document.createElement("div"));
      handle.className = `image-handle image-handle-${name}`;
      handle.dataset.handle = name;
      handle.addEventListener("pointerdown", (event) => this.startResize(event, name));
      handle.addEventListener("mousedown", (event) => event.preventDefault());
    }
    this.cropBox.addEventListener("pointerdown", (event) => this.startMove(event));
    // A wrapped image floats to the side with less room, which needs its size and its column's
    // width: known once the frame is on the page and the picture has loaded.
    this.image.addEventListener("load", () => this.refreshFrame());
    queueMicrotask(() => this.refreshFrame());
    // Images in line with text are dragged by the editor; the others move with startMove.
    this.dom.addEventListener("dragstart", (event) => {
      if (this.busy || this.layout.wrap !== "inline" || this.cropping) event.preventDefault();
    });
    this.render();
  }

  private get layout(): ImageLayout {
    return imageLayoutOf(this.node.attrs);
  }

  update(node: Node, decorations: readonly Decoration[]): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    const crop = decorations.some((decoration) => (decoration.spec as { cropping?: boolean }).cropping);
    if (crop && !this.cropping) this.startCrop();
    else if (!crop && this.cropping) this.endCrop();
    if (!this.busy && !this.cropping) this.render();
    return true;
  }

  /** Events on the handles and while cropping are the view's own; ProseMirror must not start a selection or drag. */
  stopEvent(event: Event): boolean {
    if (!(event.target instanceof Element)) return false;
    if (event.target.closest(".image-handles, .image-crop-ui")) return true;
    return this.cropping !== null && event.type !== "keydown";
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    cropSessions.delete(this.view);
  }

  private render() {
    const { src, alt, title, width, height } = this.node.attrs;
    const layout = this.layout;
    // A pasted image being uploaded (paste.ts): a grey box of its size until the upload is there.
    const uploading = typeof src === "string" && src.startsWith(PENDING_IMAGE);
    this.dom.classList.toggle("is-uploading", uploading);
    this.dom.dataset.wrap = layout.wrap;
    this.dom.dataset.positioning = layout.positioning;
    this.dom.dataset.offsetY = String(layout.offsetY);
    if (uploading) {
      this.image.removeAttribute("src");
      this.cropBox.removeAttribute("style");
      this.image.setAttribute("style", imageSizeStyle(width ?? PLACEHOLDER_SIZE.width, height ?? PLACEHOLDER_SIZE.height)!);
      this.image.alt = "Uploading image";
      return;
    }
    if (this.image.getAttribute("src") !== src) this.image.src = src ?? "";
    setAttribute(this.image, "alt", alt);
    setAttribute(this.image, "title", title);
    const filter = imageFilterStyle(layout);
    if (layout.crop) {
      this.cropBox.setAttribute("style", imageSizeStyle(width, height) ?? "");
      this.cropBox.classList.add("is-cropped");
      this.image.setAttribute("style", `${croppedImageStyle(layout.crop)}; ${filter}`);
    } else {
      this.cropBox.removeAttribute("style");
      this.cropBox.classList.remove("is-cropped");
      this.image.setAttribute("style", `${imageSizeStyle(width, height) ?? ""}; ${filter}`);
    }
    this.setFrameStyle(layout);
  }

  private refreshFrame() {
    if (!this.busy && !this.cropping && this.dom.isConnected && this.layout.wrap === "wrap") this.setFrameStyle(this.layout);
  }

  /** The frame's style for its wrap mode, keeping the page position the pagination set. */
  private setFrameStyle(layout: ImageLayout) {
    const kept = ["--image-page-top", "--image-page-shift"].map((name) => [name, this.dom.style.getPropertyValue(name)] as const);
    const shownWidth = this.shownSize().width;
    const side = layout.wrap === "wrap" ? wrapSide(layout, shownWidth, columnWidth(this.dom)) : "left";
    this.dom.setAttribute("style", imageFrameStyle(layout, shownWidth || null, side));
    for (const [name, value] of kept) if (value) this.dom.style.setProperty(name, value);
  }

  /** The image's size on the page in CSS pixels: the stored one, or as drawn. */
  private shownSize(): ImageSize {
    const { width, height } = this.node.attrs;
    if (typeof width === "number" && typeof height === "number") return { width, height };
    return { width: this.cropBox.offsetWidth || this.image.offsetWidth, height: this.cropBox.offsetHeight || this.image.offsetHeight };
  }

  private dispatchAttrs(attrs: Record<string, unknown>) {
    const pos = this.getPos();
    if (pos === undefined) return this.render();
    // Each change is an undo step of its own.
    const tr = closeHistory(this.view.state.tr).setNodeMarkup(pos, undefined, { ...this.node.attrs, ...attrs });
    this.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)));
    this.view.focus();
  }

  private startResize(event: PointerEvent, handle: ImageHandle) {
    if (event.button !== 0 || !this.view.editable) return;
    event.preventDefault();
    event.stopPropagation();
    if (this.getPos() === undefined) return;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    const visible = this.layout.crop ? this.cropBox : this.image;
    const start = { width: visible.offsetWidth, height: visible.offsetHeight };
    if (!start.width || !start.height) return;
    const scale = zoomOf(this.dom);
    const maxWidth = this.layout.wrap === "behind" || this.layout.wrap === "front" ? Infinity : columnWidth(this.dom) || Infinity;
    const rotation = (this.layout.rotation * Math.PI) / 180;
    const [startX, startY] = [event.clientX, event.clientY];
    let size = start;
    this.busy = true;
    this.dom.classList.add("is-resizing");

    const move = (moveEvent: PointerEvent) => {
      // The handles turn with the image: measure the drag along the image's own axes.
      const screenX = (moveEvent.clientX - startX) * scale;
      const screenY = (moveEvent.clientY - startY) * scale;
      const dx = screenX * Math.cos(rotation) + screenY * Math.sin(rotation);
      const dy = -screenX * Math.sin(rotation) + screenY * Math.cos(rotation);
      size = resizedImage(start, handle, dx, dy, moveEvent.shiftKey, maxWidth);
      (this.layout.crop ? this.cropBox : this.image).style.width = `${size.width}px`;
      (this.layout.crop ? this.cropBox : this.image).style.aspectRatio = `${size.width} / ${size.height}`;
    };
    const finish = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", finish);
      target.removeEventListener("pointercancel", finish);
      this.busy = false;
      this.dom.classList.remove("is-resizing");
      if (size.width === start.width && size.height === start.height) return this.render();
      this.dispatchAttrs(size);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", finish);
    target.addEventListener("pointercancel", finish);
  }

  private startRotate(event: PointerEvent) {
    if (event.button !== 0 || !this.view.editable) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    const rect = clientRect(this.dom);
    const centre = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const start = this.layout.rotation;
    let rotation = start;
    this.busy = true;
    this.dom.classList.add("is-rotating");
    const move = (moveEvent: PointerEvent) => {
      rotation = rotationAt(moveEvent.clientX - centre.x, moveEvent.clientY - centre.y, moveEvent.shiftKey);
      this.dom.style.transform = rotation === 0 ? "" : `rotate(${rotation}deg)`;
    };
    const finish = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", finish);
      target.removeEventListener("pointercancel", finish);
      this.busy = false;
      this.dom.classList.remove("is-rotating");
      if (rotation === start) return this.render();
      this.dispatchAttrs({ rotation });
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", finish);
    target.addEventListener("pointercancel", finish);
  }

  /**
   * Pressing on an image that is not in line with text and moving the pointer drags it. On release
   * it is anchored to the block under its new top edge (Move with text) or keeps its place on the page.
   */
  private startMove(event: PointerEvent) {
    const layout = this.layout;
    if (event.button !== 0 || !this.view.editable || layout.wrap === "inline" || this.cropping) return;
    const [startX, startY] = [event.clientX, event.clientY];
    const startRect = unrotatedRect(this.dom);
    const rotation = layout.rotation ? ` rotate(${layout.rotation}deg)` : "";
    const scale = zoomOf(this.dom);
    let dragging = false;
    let delta = { x: 0, y: 0 };
    const move = (moveEvent: PointerEvent) => {
      delta = { x: moveEvent.clientX - startX, y: moveEvent.clientY - startY };
      if (!dragging && Math.hypot(delta.x, delta.y) < DRAG_THRESHOLD) return;
      if (!dragging) {
        dragging = true;
        this.busy = true;
        this.dom.classList.add("is-moving");
      }
      moveEvent.preventDefault();
      this.dom.style.transform = `translate(${delta.x * scale}px, ${delta.y * scale}px)${rotation}`;
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      if (!dragging) return;
      this.busy = false;
      this.dom.classList.remove("is-moving");
      const placed = this.placeAt({ left: startRect.left + delta.x, top: startRect.top + delta.y, width: startRect.width, height: startRect.height });
      if (!placed) this.render();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }

  /** Moves the image so its unrotated top left corner is at `rect` (client coordinates). */
  private placeAt(rect: { left: number; top: number; width: number; height: number }): boolean {
    const pos = this.getPos();
    const stack = this.dom.closest<HTMLElement>(".page-stack");
    if (pos === undefined || !stack) return false;
    const { view } = this;
    const layout = this.layout;
    const scale = zoomOf(this.dom);
    const anchor = anchorBlockAt(view, rect.left + rect.width / 2, rect.top, pos);
    if (!anchor) return false;
    let attrs: Record<string, number>;
    if (layout.positioning === "fixed") {
      const stackRect = stack.getBoundingClientRect();
      const stride = pageGeometry(pageSetupOf(view.state.doc)).height + (paginationKey.getState(view.state)?.gap ?? PAGE_GAP);
      const y = (rect.top - stackRect.top) * scale;
      const page = Math.max(0, Math.floor(y / stride));
      const free = layout.wrap === "behind" || layout.wrap === "front";
      const left = free ? rect.left - stackRect.left : Math.max(0, rect.left - anchor.rect.left);
      attrs = { offsetX: round(left * scale), offsetY: round(y - page * stride) };
    } else {
      // The space a breaking image takes now, which is gone once it moves below its anchor.
      const taken = layout.wrap === "break" && anchor.pos > pos ? this.dom.offsetHeight + 2 * layout.wrapMargin * (96 / 72) : 0;
      const top = (rect.top - anchor.rect.top) * scale + taken - (layout.wrap === "break" ? layout.wrapMargin * (96 / 72) : 0);
      const left = (rect.left - anchor.rect.left) * scale;
      const free = layout.wrap === "behind" || layout.wrap === "front";
      attrs = { offsetX: round(free ? left : Math.max(0, left)), offsetY: round(free ? top : Math.max(0, top)) };
    }
    const tr = closeHistory(view.state.tr);
    if (anchor.pos === pos + this.node.nodeSize) {
      tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, ...attrs });
      tr.setSelection(NodeSelection.create(tr.doc, pos));
    } else {
      tr.delete(pos, pos + this.node.nodeSize);
      const at = tr.mapping.map(anchor.pos, -1);
      tr.insert(at, this.node.type.create({ ...this.node.attrs, ...attrs }, null, this.node.marks));
      tr.setSelection(NodeSelection.create(tr.doc, at));
    }
    view.dispatch(tr);
    view.focus();
    return true;
  }

  // Crop ------------------------------------------------------------------------------------------

  private startCrop() {
    const crop = this.layout.crop ?? NO_CROP;
    const shown = this.shownSize();
    if (!shown.width || !shown.height) return;
    const full = { width: shown.width / (1 - crop.left - crop.right), height: shown.height / (1 - crop.top - crop.bottom) };
    this.cropping = { crop, start: crop, full, shown };
    cropSessions.set(this.view, { apply: () => this.applyCrop(), cancel: () => stopCrop(this.view) });
    this.dom.classList.add("is-cropping");
    const ui = document.createElement("div");
    ui.className = "image-crop-ui";
    ui.setAttribute("aria-hidden", "true");
    const ghost = ui.appendChild(document.createElement("img"));
    ghost.className = "image-crop-ghost";
    ghost.src = this.image.src;
    ghost.draggable = false;
    const window = ui.appendChild(document.createElement("div"));
    window.className = "image-crop-window";
    const clip = window.appendChild(document.createElement("div"));
    clip.className = "image-crop-clip";
    const bright = clip.appendChild(document.createElement("img"));
    bright.src = this.image.src;
    bright.draggable = false;
    for (const name of Object.keys(handles) as ImageHandle[]) {
      const handle = window.appendChild(document.createElement("div"));
      handle.className = `image-crop-handle image-crop-handle-${name}`;
      handle.dataset.handle = name;
      handle.addEventListener("pointerdown", (event) => this.dragCropHandle(event, name));
      handle.addEventListener("mousedown", (event) => event.preventDefault());
    }
    this.cropUi = ui;
    this.dom.append(ui);
    this.drawCrop();
  }

  /** Places the whole image (dimmed) and the crop window over the frame, which keeps its size meanwhile. */
  private drawCrop() {
    if (!this.cropping || !this.cropUi) return;
    const { crop, start, full } = this.cropping;
    const ghost = this.cropUi.querySelector<HTMLElement>(".image-crop-ghost")!;
    const window = this.cropUi.querySelector<HTMLElement>(".image-crop-window")!;
    const bright = window.querySelector<HTMLElement>("img")!;
    const filter = imageFilterStyle(this.layout);
    // The frame shows the crop as it was when cropping started; positions are relative to it.
    const originX = -start.left * full.width;
    const originY = -start.top * full.height;
    ghost.setAttribute("style", `left: ${originX}px; top: ${originY}px; width: ${full.width}px; height: ${full.height}px; ${filter}`);
    const left = originX + crop.left * full.width;
    const top = originY + crop.top * full.height;
    window.setAttribute(
      "style",
      `left: ${left}px; top: ${top}px; width: ${full.width * (1 - crop.left - crop.right)}px; height: ${full.height * (1 - crop.top - crop.bottom)}px`,
    );
    bright.setAttribute("style", `left: ${-crop.left * full.width}px; top: ${-crop.top * full.height}px; width: ${full.width}px; height: ${full.height}px; ${filter}`);
  }

  private dragCropHandle(event: PointerEvent, handle: ImageHandle) {
    if (event.button !== 0 || !this.cropping) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    const scale = zoomOf(this.dom);
    const rotation = (this.layout.rotation * Math.PI) / 180;
    const start = this.cropping.crop;
    const [startX, startY] = [event.clientX, event.clientY];
    const move = (moveEvent: PointerEvent) => {
      if (!this.cropping) return;
      const screenX = (moveEvent.clientX - startX) * scale;
      const screenY = (moveEvent.clientY - startY) * scale;
      const dx = screenX * Math.cos(rotation) + screenY * Math.sin(rotation);
      const dy = -screenX * Math.sin(rotation) + screenY * Math.cos(rotation);
      this.cropping.crop = croppedBy(start, handle, dx, dy, this.cropping.full);
      this.drawCrop();
    };
    const finish = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", finish);
      target.removeEventListener("pointercancel", finish);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", finish);
    target.addEventListener("pointercancel", finish);
  }

  /** Stores the crop (Enter or a click outside): the visible part keeps its place on the page. */
  private applyCrop() {
    const session = this.cropping;
    const pos = this.getPos();
    if (!session || pos === undefined) return stopCrop(this.view);
    const { crop, start, full } = session;
    const changed = (["top", "right", "bottom", "left"] as const).some((side) => crop[side] !== start[side]);
    const tr = stopCropTransaction(this.view.state);
    if (changed) {
      const layout = this.layout;
      const width = Math.max(MIN_IMAGE_SIZE, Math.round(full.width * (1 - crop.left - crop.right)));
      const height = Math.max(MIN_IMAGE_SIZE, Math.round(full.height * (1 - crop.top - crop.bottom)));
      const moved = layout.wrap !== "inline";
      const attrs = {
        ...this.node.attrs,
        crop: Object.values(crop).some((side) => side > 0) ? crop : null,
        width,
        height,
        ...(moved && {
          offsetX: round(layout.offsetX + (crop.left - start.left) * full.width),
          offsetY: round(layout.offsetY + (crop.top - start.top) * full.height),
        }),
      };
      closeHistory(tr).setNodeMarkup(pos, undefined, attrs);
      if (this.view.state.selection instanceof NodeSelection && this.view.state.selection.from === pos) {
        tr.setSelection(NodeSelection.create(tr.doc, pos));
      }
    }
    this.view.dispatch(tr);
  }

  private endCrop() {
    this.cropping = null;
    cropSessions.delete(this.view);
    this.cropUi?.remove();
    this.cropUi = null;
    this.dom.classList.remove("is-cropping");
  }

  selectNode() {
    this.dom.classList.add("ProseMirror-selectednode");
  }

  deselectNode() {
    this.dom.classList.remove("ProseMirror-selectednode");
    // Clicking outside the image while cropping applies the crop.
    if (this.cropping) queueMicrotask(() => cropSessions.get(this.view)?.apply());
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The width of the column an image is in: the page's content (or its column), a cell or a list item. */
function columnWidth(element: HTMLElement): number {
  const parent = element.parentElement;
  if (!parent) return 0;
  const stack = parent.closest<HTMLElement>(".page-stack[data-columns]");
  const columnWidthValue = stack ? Number.parseFloat(stack.style.getPropertyValue("--column-width")) : Number.NaN;
  if (columnWidthValue > 0 && (parent.classList.contains("page-content") || parent.classList.contains("document-tab"))) return columnWidthValue;
  const style = getComputedStyle(parent);
  return parent.clientWidth - (Number.parseFloat(style.paddingLeft) || 0) - (Number.parseFloat(style.paddingRight) || 0);
}

/**
 * The top-level block (of the shown tab) that a moved image is anchored to: the one under the point,
 * or the nearest one above it. Its position is where the image goes (before it).
 */
function anchorBlockAt(view: EditorView, x: number, y: number, imagePos: number): { pos: number; rect: DOMRect } | null {
  const tab = currentTab(view.state);
  const start = tab.pos === null ? 0 : tab.from;
  let best: { pos: number; rect: DOMRect; distance: number } | null = null;
  tab.node.forEach((child, offset) => {
    const pos = start + offset;
    if (pos === imagePos) return;
    const element = view.nodeDOM(pos);
    if (!(element instanceof HTMLElement)) return;
    if (child.type.name === "image" && child.attrs.wrap !== "inline" && child.attrs.wrap !== "break") return;
    for (const rect of element.getClientRects()) {
      const inside = y >= rect.top && y <= rect.bottom;
      // Blocks in another column are only considered at the pointer's side.
      const sameColumn = x >= rect.left - 1 && x <= rect.right + 1;
      const distance = inside ? 0 : y > rect.bottom ? y - rect.bottom : (rect.top - y) * 2;
      const score = distance + (sameColumn ? 0 : 1e6);
      if (!best || score < best.distance) best = { pos, rect, distance: score };
    }
  });
  const found = best as { pos: number; rect: DOMRect; distance: number } | null;
  return found ? { pos: found.pos, rect: found.rect } : null;
}

function setAttribute(element: HTMLElement, name: string, value: unknown) {
  if (typeof value === "string" && value) element.setAttribute(name, value);
  else element.removeAttribute(name);
}

// Crop mode -------------------------------------------------------------------------------------

type CropSession = { apply: () => void; cancel: () => void };
const cropSessions = new WeakMap<EditorView, CropSession>();

type CropState = { pos: number | null };
type CropMeta = { pos: number | null };

export const imageCropKey = new PluginKey<CropState>("imageCrop");

/** Whether a character of text is at the point (client coordinates). */
function onText(x: number, y: number): boolean {
  const range = document.caretRangeFromPoint?.(x, y);
  const node = range?.startContainer;
  if (!range || node?.nodeType !== globalThis.Node.TEXT_NODE) return false;
  const length = (node as Text).length;
  for (const offset of [range.startOffset - 1, range.startOffset]) {
    if (offset < 0 || offset >= length) continue;
    const character = document.createRange();
    character.setStart(node, offset);
    character.setEnd(node, offset + 1);
    for (const rect of character.getClientRects()) {
      if (x >= rect.left - 1 && x <= rect.right + 1 && y >= rect.top && y <= rect.bottom) return true;
    }
  }
  return false;
}

/** Starts cropping the selected image ("Crop image", or a double-click on it). */
export function startCrop(view: EditorView): boolean {
  const { selection } = view.state;
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== "image" || !view.editable) return false;
  view.dispatch(view.state.tr.setMeta(imageCropKey, { pos: selection.from } satisfies CropMeta));
  return true;
}

function stopCropTransaction(state: EditorState): Transaction {
  return state.tr.setMeta(imageCropKey, { pos: null } satisfies CropMeta);
}

/** Leaves crop mode without changing the image. */
export function stopCrop(view: EditorView): void {
  if (imageCropKey.getState(view.state)?.pos !== null) view.dispatch(stopCropTransaction(view.state));
}

export function croppingImage(state: EditorState): number | null {
  return imageCropKey.getState(state)?.pos ?? null;
}

const ImageCrop = Extension.create({
  name: "imageCrop",
  addProseMirrorPlugins() {
    return [
      new Plugin<CropState>({
        key: imageCropKey,
        state: {
          init: () => ({ pos: null }),
          apply(tr, value) {
            const meta = tr.getMeta(imageCropKey) as CropMeta | undefined;
            if (meta) return { pos: meta.pos };
            if (value.pos === null || !tr.docChanged) return value;
            const mapped = tr.mapping.mapResult(value.pos);
            return { pos: mapped.deleted || tr.doc.nodeAt(mapped.pos)?.type.name !== "image" ? null : mapped.pos };
          },
        },
        props: {
          decorations(state) {
            const pos = imageCropKey.getState(state)?.pos;
            if (pos === null || pos === undefined) return null;
            const node = state.doc.nodeAt(pos);
            if (!node) return null;
            return DecorationSet.create(state.doc, [Decoration.node(pos, pos + node.nodeSize, {}, { cropping: true })]);
          },
          handleKeyDown(view, event) {
            if (imageCropKey.getState(view.state)?.pos === null) return false;
            if (event.key === "Enter") {
              cropSessions.get(view)?.apply();
              return true;
            }
            if (event.key === "Escape") {
              stopCrop(view);
              return true;
            }
            return false;
          },
          handleDOMEvents: {
            // An image behind the text is under the paragraphs: a press on it that is not on a
            // character of the text selects it.
            mousedown(view, event) {
              if (event.button !== 0 || !view.editable) return false;
              const frames = view.dom.querySelectorAll<HTMLElement>('.image-frame[data-wrap="behind"]');
              for (const frame of frames) {
                const rect = clientRect(frame);
                if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) continue;
                if ((event.target as Element | null)?.closest?.(".image-frame") === frame || onText(event.clientX, event.clientY)) return false;
                const pos = view.posAtDOM(frame, 0);
                if (view.state.doc.nodeAt(pos)?.type.name !== "image") continue;
                event.preventDefault();
                view.focus();
                view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
                return true;
              }
              return false;
            },
            // The browser's double-click (the editor's own click counting would count a third click).
            dblclick(view, event) {
              const frame = event.target instanceof Element ? event.target.closest(".image-frame") : null;
              if (!frame || !view.dom.contains(frame) || !view.editable) return false;
              const pos = view.posAtDOM(frame, 0);
              if (view.state.doc.nodeAt(pos)?.type.name !== "image") return false;
              event.preventDefault();
              view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
              return startCrop(view);
            },
          },
        },
      }),
    ];
  },
});

/** The image extension of the editor: the shared image with the node view above. */
export const EditorImage = DocsImage.extend({
  addNodeView() {
    return ({ node, view, getPos }) => new ImageView(node, view, getPos);
  },
  addExtensions() {
    return [ImageCrop];
  },
});

/** Whether the selection is an image (clicked, or right-clicked). */
export function isImage(editor: { state: EditorState }): boolean {
  const { selection } = editor.state;
  return selection instanceof NodeSelection && selection.node.type.name === "image";
}
