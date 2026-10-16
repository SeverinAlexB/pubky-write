// Text on both sides of a wrapped image (spec 19, round 5 amendment; see docs/design/images.md).
// A CSS float has text on one side only. An image with at least 1 cm of free text width on both
// sides therefore takes no room in the text (imageFrameStyle with side "both": positioned where it
// is, like an image in front of text), and each line beside it gets a gap: an inline-block widget
// from where the line's text would reach the image to the image's right edge and margin. The line's text before the gap is the left part, the text after
// it the right part. Blocks other than text (tables, images in line, lines) beside the image start
// below it, after a block widget of the missing height.
//
// The pagination calls `layOutImageWraps` before it measures. It lays the content out flat and
// without any spacers or gaps, puts a copy of every textblock beside an image in its place and adds
// gaps to the copy one line at a time (each gap changes how the rest of the paragraph wraps), so the
// blocks below are measured with the gaps above them. The copies are removed before anything is
// painted, and the gaps found become widget decorations at the positions of the copies' text.
import { imageFrameStyle, imageLayoutOf, pageGeometry, pageSetupOf, wrapSide } from "@docs/shared";
import { Extension } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { rebuildSplitTables } from "./columnLayout.ts";
import { currentTab, shownTabElement } from "./documentTabs.ts";
import { boxNodes, paginationKey } from "./pagination.ts";
import { flushPendingSelection } from "./pendingSelection.ts";
import { clientRect } from "./rects.ts";

/** A gap in a line at `pos`, `width` CSS pixels wide; a block before `pos` moved below an image by `height`. */
export type WrapGap = { pos: number; width: number };
export type WrapClear = { pos: number; height: number };
export type WrapLayout = { gaps: WrapGap[]; clears: WrapClear[] };

/** Where text must not go beside an image, in client coordinates: the image and its margin. */
type Band = { left: number; right: number; top: number; bottom: number };

/** Rounding tolerance in client pixels. */
const EPSILON = 0.5;
/** Gaps added to one paragraph before giving up (each one fixes a line). */
const MAX_STEPS = 400;

export const imageWrapKey = new PluginKey<DecorationSet>("imageWrap");

/** The gap widgets of the editor (part of the editor's image extension). */
export const ImageWrap = Extension.create({
  name: "imageWrap",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: imageWrapKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr: Transaction, value) => {
            const layout = tr.getMeta(imageWrapKey) as WrapLayout | undefined;
            if (layout) return wrapDecorations(tr.doc, layout);
            return tr.docChanged ? value.map(tr.mapping, tr.doc) : value;
          },
        },
        props: { decorations: (state) => imageWrapKey.getState(state) },
        view: (view) => new StandaloneWrapView(view),
      }),
    ];
  },
});

/**
 * Lays out the gaps of an editor without pagination (a header or footer being edited), after every
 * change, before the browser paints. With pagination, the pagination does it before it measures.
 */
class StandaloneWrapView {
  private frame = 0;

  constructor(private readonly view: EditorView) {
    this.schedule();
  }

  update(view: EditorView, previous: EditorState): void {
    if (view.state.doc !== previous.doc) this.schedule();
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const { view } = this;
      if (view.isDestroyed || paginationKey.getState(view.state)) return;
      const stack = view.dom.closest<HTMLElement>(".page-stack");
      if (stack) layOutImageWraps(view, stack, false);
    });
  }
}

function wrapDecorations(doc: Node, { gaps, clears }: WrapLayout): DecorationSet {
  return DecorationSet.create(doc, [
    ...gaps.map((gap) =>
      Decoration.widget(gap.pos, () => gapElement(gap.width), {
        // Before the cursor: a cursor at the start of the right part shows after the gap.
        side: -1,
        ignoreSelection: true,
        key: `wrap-gap:${gap.width}`,
        wrap: { gap },
      }),
    ),
    ...clears.map((clear) =>
      Decoration.widget(clear.pos, () => clearElement(clear.height), {
        side: -1,
        ignoreSelection: true,
        key: `wrap-clear:${clear.height}`,
        wrap: { clear },
      }),
    ),
  ]);
}

function gapElement(width: number): HTMLElement {
  const element = document.createElement("span");
  element.className = "image-wrap-gap";
  element.style.width = `${width}px`;
  element.setAttribute("aria-hidden", "true");
  return element;
}

function clearElement(height: number): HTMLElement {
  const element = document.createElement("div");
  element.className = "image-wrap-clear";
  element.style.height = `${height}px`;
  element.setAttribute("aria-hidden", "true");
  element.contentEditable = "false";
  return element;
}

function currentLayout(set: DecorationSet): WrapLayout {
  const layout: WrapLayout = { gaps: [], clears: [] };
  for (const decoration of set.find()) {
    const spec = decoration.spec.wrap as { gap?: WrapGap; clear?: WrapClear };
    if (spec.gap) layout.gaps.push({ pos: decoration.from, width: spec.gap.width });
    if (spec.clear) layout.clears.push({ pos: decoration.from, height: spec.clear.height });
  }
  return layout;
}

/** Whether two layouts draw the same: widths and heights may differ by layout rounding. */
export function sameWrapLayout(a: WrapLayout, b: WrapLayout): boolean {
  const close = (x: number, y: number) => Math.abs(x - y) < 0.1;
  const byPos = <T extends { pos: number }>(list: T[]) => [...list].sort((x, y) => x.pos - y.pos);
  const [gapsA, gapsB, clearsA, clearsB] = [byPos(a.gaps), byPos(b.gaps), byPos(a.clears), byPos(b.clears)];
  return (
    gapsA.length === gapsB.length &&
    clearsA.length === clearsB.length &&
    gapsA.every((gap, i) => gap.pos === gapsB[i]!.pos && close(gap.width, gapsB[i]!.width)) &&
    clearsA.every((clear, i) => clear.pos === clearsB[i]!.pos && close(clear.height, clearsB[i]!.height))
  );
}

/** ProseMirror's DOM observer, which must not see the copies (not public API). */
type DomObserver = { stop(): void; start(): void };

/**
 * Lays out the gaps beside images with text on both sides in the shown tab; returns whether they
 * changed. `flatColumns`: the content is in columns, which are laid out as one for measuring.
 */
export function layOutImageWraps(view: EditorView, stack: HTMLElement, flatColumns: boolean): boolean {
  const current = imageWrapKey.getState(view.state);
  if (!current) return false;
  const root = shownTabElement(view);
  refreshWrapSides(root);
  const images = root.querySelector('.image-frame[data-wrap="wrap"][data-wrap-side="both"]') !== null;
  if (!images && current.find().length === 0) return false;
  const stackWidth = stack.getBoundingClientRect().width;
  if (stackWidth === 0) return false;
  const scale = stackWidth / pageGeometry(pageSetupOf(view.state.doc)).width;
  const layout = images ? measureFlat(view, stack, flatColumns, findGaps(view, root, scale)) : { gaps: [], clears: [] };
  if (sameWrapLayout(currentLayout(current), layout)) return false;
  flushPendingSelection(view);
  view.dispatch(view.state.tr.setMeta(imageWrapKey, layout).setMeta("addToHistory", false));
  return true;
}

/**
 * Runs `measure` with the content laid out without spacers and gaps (and in one column), then undoes
 * the changes to the DOM it registers in `restore` (last first).
 */
function measureFlat<T>(view: EditorView, stack: HTMLElement, flatColumns: boolean, measure: (restore: (() => void)[]) => T): T {
  const observer = (view as unknown as { domObserver?: DomObserver }).domObserver;
  const scroller = stack.closest<HTMLElement>(".editor-scroll");
  const scrollTop = scroller?.scrollTop;
  const restore: (() => void)[] = [];
  observer?.stop();
  stack.classList.add("is-measuring-wraps");
  if (flatColumns) stack.classList.add("is-measuring-columns");
  rebuildSplitTables(stack);
  try {
    return measure(restore);
  } finally {
    for (const undo of restore.reverse()) undo();
    stack.classList.remove("is-measuring-wraps", "is-measuring-columns");
    rebuildSplitTables(stack);
    observer?.start();
    if (scroller && scrollTop !== undefined && scroller.scrollTop !== scrollTop) scroller.scrollTop = scrollTop;
  }
}

/** The views of wrapped images, which pick their side from their column's width. */
const wrapSideRefreshers = new WeakMap<Element, () => void>();

export function registerWrapSide(frame: HTMLElement, refresh: () => void): void {
  wrapSideRefreshers.set(frame, refresh);
}

/** Lets every wrapped image pick its side again: the width of its column may have changed. */
function refreshWrapSides(root: HTMLElement): void {
  for (const frame of root.querySelectorAll('.image-frame[data-wrap="wrap"]')) wrapSideRefreshers.get(frame)?.();
}

function findGaps(view: EditorView, root: HTMLElement, scale: number): (restore: (() => void)[]) => WrapLayout {
  return (restore) => {
    const layout: WrapLayout = { gaps: [], clears: [] };
    // Blocks are only looked at from the first image with text on both sides, until the last band ends.
    const images = Array.from(root.querySelectorAll('.image-frame[data-wrap="wrap"][data-wrap-side="both"]'), (frame) => view.posAtDOM(frame, 0)).sort(
      (a, b) => a - b,
    );
    let next = 0;
    let bands: Band[] = [];
    for (const { node, pos } of boxNodes(view.state.doc, currentTab(view.state))) {
      if (bands.length === 0) {
        if (next >= images.length) break;
        if (pos < images[next]!) continue;
      }
      while (next < images.length && images[next]! <= pos) next++;
      const element = view.nodeDOM(pos);
      if (!(element instanceof HTMLElement) || element.getClientRects().length === 0) continue;
      if (node.type.name === "image") {
        if (element.dataset.wrap === "wrap" && element.dataset.wrapSide === "both") bands.push(bandOf(element, Number(node.attrs.wrapMargin) || 0, scale));
        // Images that float or are placed freely take no part in the lines.
        if (node.attrs.wrap === "wrap" || node.attrs.wrap === "behind" || node.attrs.wrap === "front") continue;
      }
      if (bands.length === 0) continue;
      const rect = clientRect(element);
      // The content is in one column here, so blocks only go down: bands above them are done.
      bands = bands.filter((band) => band.bottom > rect.top + EPSILON);
      const beside = bands.filter((band) => rect.top < band.bottom - EPSILON && rect.bottom > band.top + EPSILON);
      if (beside.length === 0) continue;
      if (node.isTextblock) {
        const gaps = wrapTextblock(view, element, beside, scale, restore);
        if (gaps) layout.gaps.push(...gaps);
      } else {
        // Not text: the block starts below the lowest image beside it.
        const height = round((Math.max(...beside.map((band) => band.bottom)) - rect.top) / scale);
        const clear = clearElement(height);
        clear.classList.add("is-measure");
        element.before(clear);
        restore.push(() => clear.remove());
        layout.clears.push({ pos, height });
      }
    }
    return layout;
  };
}

/**
 * Text on both sides of wrapped images in static content (the copies of headers and footers on the
 * pages, and where the pagination measures them): gives each wrapped image the side it has room for
 * in `container`, and adds the gaps and moves blocks below the image in place. `scale` is client
 * pixels per CSS pixel. Running it again starts over.
 */
export function layOutStaticWraps(container: HTMLElement, scale: number): void {
  for (const element of container.querySelectorAll(".image-wrap-gap, .image-wrap-clear")) element.remove();
  const frames = Array.from(container.querySelectorAll<HTMLElement>('.image-frame[data-wrap="wrap"]'));
  if (frames.length === 0) return;
  container.normalize();
  const style = getComputedStyle(container);
  const width = container.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
  const bands: { frame: HTMLElement; band: Band }[] = [];
  for (const frame of frames) {
    const image = frame.querySelector("img");
    const layout = imageLayoutOf({
      wrap: "wrap",
      wrapMargin: numberOf(frame.dataset.wrapMargin),
      positioning: frame.dataset.positioning,
      offsetX: numberOf(frame.dataset.offsetX),
      offsetY: numberOf(frame.dataset.offsetY),
      rotation: numberOf(frame.dataset.rotation),
    });
    const shown = numberOf(image?.getAttribute("width")) ?? frame.offsetWidth;
    const side = wrapSide(layout, shown, width);
    frame.dataset.wrapSide = side;
    // The static frame (renderHTML) has the style of an image floating left.
    const frameStyle = imageFrameStyle(layout, shown, side);
    if (frame.getAttribute("style") !== frameStyle) frame.setAttribute("style", frameStyle);
    if (side === "both") bands.push({ frame, band: bandOf(frame, layout.wrapMargin, scale) });
  }
  const visit = (element: Element) => {
    for (const child of Array.from(element.children)) {
      if (!(child instanceof HTMLElement) || child.matches(".image-frame")) continue;
      if (child.matches("ul, ol, li, blockquote")) {
        visit(child);
        continue;
      }
      const beside = bands
        .filter(({ frame }) => frame.compareDocumentPosition(child) & globalThis.Node.DOCUMENT_POSITION_FOLLOWING)
        .map(({ band }) => band)
        .filter((band) => {
          const rect = clientRect(child);
          return rect.top < band.bottom - EPSILON && rect.bottom > band.top + EPSILON;
        });
      if (beside.length === 0) continue;
      if (child.matches("p, h1, h2, h3, h4, h5, h6")) {
        for (const gap of addGaps(child, beside, scale)) gap.classList.remove("is-measure");
      } else {
        child.before(clearElement(round((Math.max(...beside.map((band) => band.bottom)) - clientRect(child).top) / scale)));
      }
    }
  };
  if (bands.length > 0) visit(container);
}

function numberOf(value: string | null | undefined): number | undefined {
  const number = Number.parseFloat(value ?? "");
  return Number.isFinite(number) ? number : undefined;
}

/** The image's box without its rotation (text wraps around the unrotated box, as with floats) and its margin. */
function bandOf(frame: HTMLElement, marginPt: number, scale: number): Band {
  const rect = clientRect(frame);
  const width = frame.offsetWidth * scale;
  const height = frame.offsetHeight * scale;
  const margin = marginPt * (96 / 72) * scale;
  const centreX = rect.left + rect.width / 2;
  const centreY = rect.top + rect.height / 2;
  return {
    left: centreX - width / 2 - margin,
    right: centreX + width / 2 + margin,
    top: centreY - height / 2,
    bottom: centreY + height / 2 + margin,
  };
}

/**
 * Adds the gaps a textblock needs to a copy of it put in its place, and returns them with document
 * positions. Null if the copy does not match the original (it always should).
 */
function wrapTextblock(view: EditorView, original: HTMLElement, bands: Band[], scale: number, restore: (() => void)[]): WrapGap[] | null {
  const copy = original.cloneNode(true) as HTMLElement;
  for (const gap of copy.querySelectorAll(".image-wrap-gap")) gap.remove();
  original.before(copy);
  original.classList.add("is-wrap-measured");
  restore.push(() => {
    copy.remove();
    original.classList.remove("is-wrap-measured");
  });
  const origins = matchNodes(original, copy);
  if (!origins) return null;
  const elements = addGaps(copy, bands, scale, (text, rest, index) => {
    const origin = origins.texts.get(text);
    if (origin) origins.texts.set(rest, { text: origin.text, base: origin.base + index });
  });
  const gaps: WrapGap[] = [];
  for (const element of elements) {
    // A gap is right before a piece of text or an inline atom of the copy, or before another gap there
    // (a gap that ends a line, then one that starts the next).
    let next = element.nextSibling;
    while (next instanceof Element && next.classList.contains("image-wrap-gap")) next = next.nextSibling;
    const text = next instanceof Text ? origins.texts.get(next) : undefined;
    const atom = next instanceof Element ? origins.elements.get(next) : undefined;
    try {
      if (text) gaps.push({ pos: view.posAtDOM(text.text, text.base), width: parseFloat(element.style.width) });
      else if (atom?.parentNode) gaps.push({ pos: view.posAtDOM(atom.parentNode, indexIn(atom)), width: parseFloat(element.style.width) });
    } catch {
      // Not in the document (cannot happen for text of the copy).
    }
  }
  return gaps;
}

/**
 * Adds gaps to `block` (as laid out now) until none of its text is on the image or margin of a band,
 * one line at a time, and returns them. `onSplit` hears of every text node split for a gap.
 */
function addGaps(block: HTMLElement, bands: Band[], scale: number, onSplit?: (text: Text, rest: Text, index: number) => void): HTMLElement[] {
  const placed: { element: HTMLElement; band: Band }[] = [];
  const range = document.createRange();
  for (let step = 0; step < MAX_STEPS; step++) {
    const hit = firstOverlap(block, bands, range);
    if (!hit) break;
    const gapBefore = placed.find((gap) => gap.band === hit.band && sameLine(clientRect(gap.element), hit.rect));
    if (gapBefore && gapBefore.element.compareDocumentPosition(hit.text) & globalThis.Node.DOCUMENT_POSITION_FOLLOWING) {
      // Text after the gap still reaches the image: the gap is too narrow (alignment moved it).
      const missing = (hit.band.right - clientRect(gapBefore.element).right) / scale;
      if (missing <= 0.01) break;
      gapBefore.element.style.width = `${round(parseFloat(gapBefore.element.style.width) + missing + 0.25)}px`;
      continue;
    }
    if (gapBefore) {
      // Text before the gap reaches the image (justified or centred lines): start the gap earlier.
      gapBefore.element.remove();
      placed.splice(placed.indexOf(gapBefore), 1);
    }
    const start = wordStart(block, hit.text, hit.index, hit.rect, range);
    const left = start.atom ? clientRect(start.atom).left : charRect(start.text, start.index, range)?.left;
    if (left === undefined) break;
    const element = gapElement(round(Math.max(0, hit.band.right - left) / scale));
    element.classList.add("is-measure");
    if (start.atom) {
      start.atom.before(element);
    } else if (start.index > 0) {
      const rest = start.text.splitText(start.index);
      onSplit?.(start.text, rest, start.index);
      rest.before(element);
    } else {
      start.text.before(element);
    }
    placed.push({ element, band: hit.band });
  }
  return placed.map((gap) => gap.element);
}

/** The first character of the copy (not white space) that is on the image or its margin. */
function firstOverlap(copy: HTMLElement, bands: Band[], range: Range): { text: Text; index: number; rect: DOMRect; band: Band } | null {
  const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    range.selectNodeContents(text);
    for (const fragment of range.getClientRects()) {
      const band = bands.find((candidate) => overlaps(fragment, candidate));
      if (!band) continue;
      // The first character on the fragment's line (characters are in line order), then along the line.
      let low = 0;
      let high = text.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        const rect = charRect(text, middle, range);
        if (rect && (rect.top + rect.bottom) / 2 < fragment.top) low = middle + 1;
        else high = middle;
      }
      for (let index = low; index < text.length; index++) {
        const rect = charRect(text, index, range);
        if (!rect) continue;
        if (rect.top >= fragment.bottom - EPSILON) break;
        if (/\s/.test(text.data[index]!)) continue;
        const on = bands.find((candidate) => overlaps(rect, candidate));
        if (on) return { text, index, rect, band: on };
      }
      range.selectNodeContents(text);
    }
  }
  return null;
}

function overlaps(rect: DOMRect, band: Band): boolean {
  return (
    rect.width > 0 &&
    rect.right > band.left + EPSILON &&
    rect.left < band.right - EPSILON &&
    rect.bottom > band.top + EPSILON &&
    rect.top < band.bottom - EPSILON
  );
}

/** Whether `a` is on the line of `b`: its middle (for a gap without height, its baseline) is within `b`. */
function sameLine(a: DOMRect, b: DOMRect): boolean {
  const middle = (a.top + a.bottom) / 2;
  return middle >= b.top - 1 && middle <= b.bottom + 1;
}

function charRect(text: Text, index: number, range: Range): DOMRect | null {
  range.setStart(text, index);
  range.setEnd(text, index + 1);
  for (const rect of range.getClientRects()) if (rect.width > 0 || rect.height > 0) return rect;
  return null;
}

/**
 * Where the word with the character at `index` starts on its line: in the same text node, or in the
 * text nodes before it (a word can span marks). Inline atoms (footnote references, tabs) end words:
 * the gap goes before a word or an atom.
 */
function wordStart(copy: HTMLElement, text: Text, index: number, line: DOMRect, range: Range): { text: Text; index: number; atom?: Element } {
  const atom = atomOf(text, copy);
  if (atom) return { text, index: 0, atom };
  let current = text;
  let start = index;
  for (;;) {
    while (start > 0 && !/\s/.test(current.data[start - 1]!)) {
      const rect = charRect(current, start - 1, range);
      if (rect && !sameLine(rect, line)) return { text: current, index: start };
      start--;
    }
    if (start > 0) return { text: current, index: start };
    const previous = previousText(copy, current);
    if (!previous || atomOf(previous, copy) || previous.length === 0 || /\s/.test(previous.data[previous.length - 1]!)) {
      return { text: current, index: 0 };
    }
    const rect = charRect(previous, previous.length - 1, range);
    if (!rect || !sameLine(rect, line)) return { text: current, index: 0 };
    current = previous;
    start = previous.length;
  }
}

function previousText(copy: HTMLElement, text: Text): Text | null {
  const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
  walker.currentNode = text;
  return walker.previousNode() as Text | null;
}

/** The inline atom (a non-editable node view) the text is part of, if any. */
function atomOf(text: Text, copy: HTMLElement): Element | null {
  let atom: Element | null = null;
  for (let element = text.parentElement; element && element !== copy; element = element.parentElement) {
    if (element.getAttribute("contenteditable") === "false") atom = element;
  }
  return atom;
}

/** The original's text node (and the offset of the copy's text in it) and element for each node of the copy. */
type Origins = { texts: Map<Text, { text: Text; base: number }>; elements: Map<Element, Element> };

function matchNodes(original: HTMLElement, copy: HTMLElement): Origins | null {
  const origins: Origins = { texts: new Map(), elements: new Map() };
  const children = (node: globalThis.Node) =>
    Array.from(node.childNodes).filter((child) => !(child instanceof Element && child.classList.contains("image-wrap-gap")));
  const visit = (from: globalThis.Node, to: globalThis.Node): boolean => {
    const a = children(from);
    const b = children(to);
    if (a.length !== b.length) return false;
    return a.every((child, index) => {
      const other = b[index]!;
      if (child instanceof Text && other instanceof Text) {
        origins.texts.set(other, { text: child, base: 0 });
        return true;
      }
      if (child instanceof Element && other instanceof Element) {
        origins.elements.set(other, child);
        return visit(child, other);
      }
      return child.nodeType === other.nodeType;
    });
  };
  return visit(original, copy) ? origins : null;
}

function indexIn(element: Element): number {
  return Array.prototype.indexOf.call(element.parentNode!.childNodes, element) as number;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
