// Where the document's content breaks into pages. Pure geometry, so it can be tested
// without a browser: the editor measures its blocks and lines as they would be laid out
// without any page spacers ("natural" positions), and this decides which spacers push
// content past the bottom margin, the gap and the next page's top margin.

/** Vertical page geometry in CSS pixels. Pages are stacked with `gap` between them. */
export type PageFrame = { pageHeight: number; gap: number; marginTop: number; marginBottom: number };

export type LayoutLine = {
  top: number;
  bottom: number;
  /** Document position at the start of the line; only asked for lines that move. */
  start: () => number;
};

/** A block that is laid out as a unit: a textblock (which can break between lines) or an atomic block. */
export type LayoutBox = {
  top: number;
  bottom: number;
  /** Where a spacer goes to move the whole box to the next page (before its outermost container that it starts). */
  breakPos: number;
  /** The lines of a textblock; atomic blocks such as images and tables have none and move whole. */
  lines?: () => LayoutLine[];
  /** A page break: the next box starts on a new page. */
  pageBreak?: boolean;
};

/** Pushes the content after `pos` down by `shift` pixels. Inline spacers sit at the start of a line. */
export type PageSpacer = { pos: number; shift: number; inline: boolean };

/** Rounding tolerance: content within half a pixel of the limit still fits. */
const EPSILON = 0.5;

export function pageStride(frame: PageFrame): number {
  return frame.pageHeight + frame.gap;
}

export function contentTop(frame: PageFrame, page: number): number {
  return page * pageStride(frame) + frame.marginTop;
}

export function contentBottom(frame: PageFrame, page: number): number {
  return page * pageStride(frame) + frame.pageHeight - frame.marginBottom;
}

function pageAt(frame: PageFrame, y: number): number {
  return Math.max(0, Math.floor(y / pageStride(frame)));
}

/**
 * Breaks the boxes (in document order, at their natural positions) into pages.
 * A line that does not fit continues at the next page's top margin; a box that does not
 * fit and cannot break moves whole, unless it already starts at the top of a page.
 */
export function paginate(boxes: LayoutBox[], frame: PageFrame): { spacers: PageSpacer[]; pageCount: number } {
  const spacers: PageSpacer[] = [];
  let shift = 0;
  let page = 0;
  let end = 0;
  let breakAfterPage: number | null = null;

  const push = (pos: number, amount: number, inline: boolean): boolean => {
    if (amount <= EPSILON) return false;
    const rounded = Math.round(amount * 100) / 100;
    const previous = spacers.at(-1);
    if (previous && previous.pos === pos && previous.inline === inline) previous.shift += rounded;
    else spacers.push({ pos, shift: rounded, inline });
    shift += rounded;
    return true;
  };

  for (const box of boxes) {
    page = Math.max(page, pageAt(frame, box.top + shift));
    if (breakAfterPage !== null) {
      const target = breakAfterPage + 1;
      push(box.breakPos, contentTop(frame, target) - (box.top + shift), false);
      page = Math.max(page, target);
      breakAfterPage = null;
    }

    let firstLine = 0;
    while (box.bottom + shift > contentBottom(frame, page) + EPSILON) {
      const limit = contentBottom(frame, page);
      const top = box.top + shift;
      const lines = box.lines?.() ?? [];
      let moved: boolean;
      if (lines.length > 0) {
        let index = -1;
        for (let i = firstLine; i < lines.length; i++) {
          if (lines[i]!.bottom + shift > limit + EPSILON) {
            index = i;
            break;
          }
        }
        // Only space after the last line hangs over the margin.
        if (index === -1) break;
        if (index === 0) {
          moved = top > contentTop(frame, page) + EPSILON && push(box.breakPos, contentTop(frame, page + 1) - top, false);
        } else {
          const line = lines[index]!;
          moved = push(line.start(), contentTop(frame, page + 1) - (line.top + shift), true);
          firstLine = index;
        }
      } else {
        // Atomic blocks taller than a page stay where they are and overflow.
        moved = top > contentTop(frame, page) + EPSILON && push(box.breakPos, contentTop(frame, page + 1) - top, false);
      }
      if (!moved) break;
      page += 1;
    }

    if (box.pageBreak) breakAfterPage = page;
    end = Math.max(end, box.bottom + shift);
  }

  let pageCount = Math.max(page, pageAt(frame, end - EPSILON)) + 1;
  // A page break at the very end still starts a (blank) page.
  if (breakAfterPage !== null) pageCount = Math.max(pageCount, breakAfterPage + 2);
  return { spacers, pageCount };
}

export function sameSpacers(a: readonly PageSpacer[], b: readonly PageSpacer[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (spacer, i) => spacer.pos === b[i]!.pos && spacer.inline === b[i]!.inline && Math.abs(spacer.shift - b[i]!.shift) < EPSILON,
    )
  );
}
