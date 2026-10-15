// Images with "Fix position on page": their offsets are from the top left corner of the page their
import { clientRect } from "./rects.ts";
// anchor paragraph is on, which only the pagination knows. Before measuring, it tells each such
// image where that page starts through a CSS variable its frame style reads (see imageFrameStyle in
// shared/src/images.ts and docs/design/images.md).

const SPACERS = ".page-spacer, .column-spacer, .table-page-spacer";

/**
 * Sets `--image-page-top` (behind or in front of text: the page's top, for `top`) or
 * `--image-page-shift` (wrapped or breaking text: how far the image moves from where its anchor
 * paragraph starts) on every fixed image in `root`. Returns whether anything changed.
 */
export function placeFixedImages(root: HTMLElement, toY: (clientY: number) => number, stride: number): boolean {
  let changed = false;
  for (const frame of root.querySelectorAll<HTMLElement>('.image-frame[data-positioning="fixed"]')) {
    const wrap = frame.dataset.wrap;
    if (wrap === "behind" || wrap === "front") {
      const anchor = anchorOf(frame);
      if (!anchor) continue;
      const page = Math.max(0, Math.floor(toY(clientRect(anchor).top) / stride));
      changed = setVariable(frame, "--image-page-top", `${page * stride}px`) || changed;
    } else if (wrap === "wrap" || wrap === "break") {
      const current = Number.parseFloat(frame.style.getPropertyValue("--image-page-shift")) || 0;
      const offsetY = Number(frame.dataset.offsetY) || 0;
      // Where the image would be without its offset: the top of its anchor paragraph. A rotated
      // frame keeps its centre, so its unrotated top is half its height above that.
      const rect = clientRect(frame);
      const anchorTop = toY(rect.top + rect.height / 2) - frame.offsetHeight / 2 - current - offsetY;
      const page = Math.max(0, Math.floor(anchorTop / stride));
      changed = setVariable(frame, "--image-page-shift", `${Math.round((page * stride - anchorTop) * 100) / 100}px`) || changed;
    }
  }
  return changed;
}

/** The block after the image, which the image is anchored to. */
function anchorOf(frame: HTMLElement): Element | null {
  let next = frame.nextElementSibling;
  while (next?.matches(SPACERS)) next = next.nextElementSibling;
  return next ?? frame.parentElement;
}

function setVariable(element: HTMLElement, name: string, value: string): boolean {
  if (element.style.getPropertyValue(name) === value) return false;
  element.style.setProperty(name, value);
  return true;
}
