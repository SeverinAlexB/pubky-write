// Where the document's content breaks into pages. Pure geometry, so it can be tested
// without a browser: the editor measures its blocks and lines as they would be laid out
// without any page spacers ("natural" positions), and this decides which spacers push
// content past the bottom margin, the gap and the next page's top margin.

/**
 * Vertical page geometry in CSS pixels. Pages are stacked with `gap` between them. The first
 * page can have its own margins (a different first-page header or footer can move them).
 */
export type PageFrame = {
  pageHeight: number;
  gap: number;
  marginTop: number;
  marginBottom: number;
  firstMarginTop?: number;
  firstMarginBottom?: number;
};

export type LayoutLine = {
  top: number;
  bottom: number;
  /** Document position at the start of the line; only asked for lines that move. */
  start: () => number;
};

/** A footnote whose reference is in a box: where the reference is and how tall its text is at the page bottom. */
export type LayoutFootnote = { index: number; top: number; bottom: number; height: number };

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
  /** Footnotes referenced in the box; their text needs room at the bottom of the reference's page. */
  footnotes?: LayoutFootnote[];
};

/** Space the footnote area needs above its first footnote: a gap, the separator line and 8px. */
export const FOOTNOTE_SEPARATOR_SPACE = 20;

/** Pushes the content after `pos` down by `shift` pixels. Inline spacers sit at the start of a line. */
export type PageSpacer = { pos: number; shift: number; inline: boolean };

/** Rounding tolerance: content within half a pixel of the limit still fits. */
const EPSILON = 0.5;

export function pageStride(frame: PageFrame): number {
  return frame.pageHeight + frame.gap;
}

/** Where the content of `page` starts, from the top of the first page. */
export function contentTop(frame: PageFrame, page: number): number {
  return page * pageStride(frame) + (page === 0 ? (frame.firstMarginTop ?? frame.marginTop) : frame.marginTop);
}

/** Where the content of `page` ends (before its footnotes). */
export function contentBottom(frame: PageFrame, page: number): number {
  return page * pageStride(frame) + frame.pageHeight - (page === 0 ? (frame.firstMarginBottom ?? frame.marginBottom) : frame.marginBottom);
}

function pageAt(frame: PageFrame, y: number): number {
  return Math.max(0, Math.floor(y / pageStride(frame)));
}

/**
 * Breaks the boxes (in document order, at their natural positions) into pages.
 * A line that does not fit continues at the next page's top margin; a box that does not
 * fit and cannot break moves whole, unless it already starts at the top of a page.
 * Footnotes take their space from the bottom of the page their reference's line is on: a line
 * whose footnotes do not fit below it moves to the next page with them.
 */
export function paginate(
  boxes: LayoutBox[],
  frame: PageFrame,
): { spacers: PageSpacer[]; pageCount: number; footnotePages: number[] } {
  const spacers: PageSpacer[] = [];
  const footnotePages: number[] = [];
  /** Height taken by footnotes at the bottom of each page. */
  const footnoteSpace: number[] = [];
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
  const limit = (target: number) => contentBottom(frame, target) - (footnoteSpace[target] ?? 0);
  /** Extra space footnotes need on a page: their text, and the separator for the page's first. */
  const demand = (target: number, notes: readonly LayoutFootnote[]) =>
    notes.length === 0 ? 0 : notes.reduce((sum, note) => sum + note.height, 0) + (footnoteSpace[target] ? 0 : FOOTNOTE_SEPARATOR_SPACE);
  const place = (target: number, notes: readonly LayoutFootnote[]) => {
    if (notes.length === 0) return;
    footnoteSpace[target] = (footnoteSpace[target] ?? 0) + demand(target, notes);
    for (const note of notes) footnotePages[note.index] = target;
  };

  for (const box of boxes) {
    page = Math.max(page, pageAt(frame, box.top + shift));
    if (breakAfterPage !== null) {
      const target = breakAfterPage + 1;
      push(box.breakPos, contentTop(frame, target) - (box.top + shift), false);
      page = Math.max(page, target);
      breakAfterPage = null;
    }

    const notes = box.footnotes ?? [];
    // Most boxes fit where they are; only look at lines when they do not, or carry footnotes.
    const fits = notes.length === 0 && box.bottom + shift <= limit(page) + EPSILON;
    const lines = fits ? [] : (box.lines?.() ?? []);
    if (!fits && lines.length === 0) {
      // Atomic blocks taller than a page stay where they are and overflow.
      while (box.bottom + shift > limit(page) - demand(page, notes) + EPSILON) {
        const top = box.top + shift;
        if (!(top > contentTop(frame, page) + EPSILON && push(box.breakPos, contentTop(frame, page + 1) - top, false))) break;
        page += 1;
      }
      place(page, notes);
    } else if (!fits) {
      const lineNotes = notesByLine(lines, notes);
      // Only space after the last line hangs over the margin: each line has to fit.
      lines.forEach((line, index) => {
        const own = lineNotes[index]!;
        while (line.bottom + shift > limit(page) - demand(page, own) + EPSILON) {
          let moved: boolean;
          if (index === 0) {
            const top = box.top + shift;
            moved = top > contentTop(frame, page) + EPSILON && push(box.breakPos, contentTop(frame, page + 1) - top, false);
          } else {
            const top = line.top + shift;
            moved = top > contentTop(frame, page) + EPSILON && push(line.start(), contentTop(frame, page + 1) - top, true);
          }
          if (!moved) break;
          page += 1;
        }
        place(page, own);
      });
    }

    if (box.pageBreak) breakAfterPage = page;
    end = Math.max(end, box.bottom + shift);
  }

  let pageCount = Math.max(page, pageAt(frame, end - EPSILON)) + 1;
  // A page break at the very end still starts a (blank) page.
  if (breakAfterPage !== null) pageCount = Math.max(pageCount, breakAfterPage + 2);
  return { spacers, pageCount, footnotePages };
}

/** The footnotes of each line: a reference belongs to the line its middle is on. */
function notesByLine(lines: readonly LayoutLine[], notes: readonly LayoutFootnote[]): LayoutFootnote[][] {
  const result = lines.map((): LayoutFootnote[] => []);
  for (const note of notes) {
    const middle = (note.top + note.bottom) / 2;
    const index = lines.findIndex((line) => middle < line.bottom);
    result[index === -1 ? lines.length - 1 : index]!.push(note);
  }
  return result;
}

export function sameSpacers(a: readonly PageSpacer[], b: readonly PageSpacer[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (spacer, i) => spacer.pos === b[i]!.pos && spacer.inline === b[i]!.inline && Math.abs(spacer.shift - b[i]!.shift) < EPSILON,
    )
  );
}
