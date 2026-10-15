// Where the document's content breaks into pages. Pure geometry, so it can be tested
// without a browser: the editor measures its blocks and lines as they would be laid out
// without any page spacers ("natural" positions), and this decides which spacers push
// content past the bottom margin, the gap and the next page's top margin.

/**
 * Vertical page geometry in CSS pixels. Pages are stacked with `gap` between them. The first
 * page can have its own margins (a different first-page header or footer can move them).
 * With `columns` (Format > Columns), each page holds that many columns of the same height.
 */
export type PageFrame = {
  pageHeight: number;
  gap: number;
  marginTop: number;
  marginBottom: number;
  firstMarginTop?: number;
  firstMarginBottom?: number;
  columns?: number;
};

export type LayoutLine = {
  top: number;
  bottom: number;
  /** Document position at the start of the line; only asked for lines that move. */
  start: () => number;
  /**
   * Height drawn above the line when it starts a page: the pinned header rows a table repeats
   * at the top of every page it continues to.
   */
  carry?: number;
};

/** A footnote whose reference is in a box: where the reference is and how tall its text is at the page bottom. */
export type LayoutFootnote = { index: number; top: number; bottom: number; height: number };

/** A block that is laid out as a unit: a textblock (which can break between lines) or an atomic block. */
export type LayoutBox = {
  top: number;
  bottom: number;
  /** Where a spacer goes to move the whole box to the next page (before its outermost container that it starts). */
  breakPos: number;
  /** The lines of a textblock (or the rows of a table); atomic blocks such as images have none and move whole. */
  lines?: () => LayoutLine[];
  /** A page break: the next box starts on a new page. */
  pageBreak?: boolean;
  /** A column break: the next box starts in the next column (or on a new page after the last one). */
  columnBreak?: boolean;
  /** Footnotes referenced in the box; their text needs room at the bottom of the reference's page. */
  footnotes?: LayoutFootnote[];
};

/** Space the footnote area needs above its first footnote: a gap, the separator line and 8px. */
export const FOOTNOTE_SEPARATOR_SPACE = 20;

/**
 * Pushes the content after `pos` down by `shift` pixels. Inline spacers sit at the start of a line.
 * With columns, `from` and `to` are the slots (page × columns + column) of the content before and
 * after the spacer, and the shift is in a strip where every column is laid out as its own page.
 */
export type PageSpacer = { pos: number; shift: number; inline: boolean; carry?: number; from?: number; to?: number };

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

export function columnCount(frame: PageFrame): number {
  return Math.max(1, Math.floor(frame.columns ?? 1));
}

/**
 * Columns are laid out as a strip of slots, one per column, each as tall as a page: slot s is
 * column `s % columns` of page `floor(s / columns)`. With one column a slot is a page.
 */
function slotTop(frame: PageFrame, slot: number): number {
  const page = Math.floor(slot / columnCount(frame));
  return contentTop(frame, page) + (slot - page) * pageStride(frame);
}

function slotBottom(frame: PageFrame, slot: number): number {
  const page = Math.floor(slot / columnCount(frame));
  return contentBottom(frame, page) + (slot - page) * pageStride(frame);
}

function slotAt(frame: PageFrame, y: number): number {
  return Math.max(0, Math.floor(y / pageStride(frame)));
}

export type Pagination = {
  spacers: PageSpacer[];
  pageCount: number;
  footnotePages: number[];
  /** With columns: how tall the content of each slot is, from its top. */
  slotHeights?: number[];
  /** With columns: the slot the content ends in. */
  lastSlot?: number;
};

/**
 * Breaks the boxes (in document order, at their natural positions) into pages.
 * A line that does not fit continues at the next page's top margin; a box that does not
 * fit and cannot break moves whole, unless it already starts at the top of a page.
 * Footnotes take their space from the bottom of the page their reference's line is on: a line
 * whose footnotes do not fit below it moves to the next page with them.
 * With columns the boxes are laid out at the column's width, and the same rules fill each column
 * before the next one: a "page" below is a column (a slot).
 */
export function paginate(boxes: LayoutBox[], frame: PageFrame): Pagination {
  const columns = columnCount(frame);
  const spacers: PageSpacer[] = [];
  const footnotePages: number[] = [];
  /** Height taken by footnotes at the bottom of each page. */
  const footnoteSpace: number[] = [];
  const slotHeights: number[] = [];
  const pageOf = (slot: number) => Math.floor(slot / columns);
  let shift = 0;
  let slot = 0;
  let end = 0;
  let breakAfter: { slot: number; target: number } | null = null;

  const push = (pos: number, amount: number, inline: boolean, target: number, carry = 0): boolean => {
    if (amount <= EPSILON) return false;
    const rounded = Math.round(amount * 100) / 100;
    const previous = spacers.at(-1);
    if (previous && previous.pos === pos && previous.inline === inline) {
      previous.shift += rounded;
      if (columns > 1) previous.to = target;
    } else {
      spacers.push({ pos, shift: rounded, inline, ...(carry > 0 && { carry }), ...(columns > 1 && { from: slot, to: target }) });
    }
    shift += rounded;
    return true;
  };
  const limit = (target: number) => slotBottom(frame, target) - (footnoteSpace[pageOf(target)] ?? 0);
  /** Extra space footnotes need on a page: their text, and the separator for the page's first. */
  const demand = (target: number, notes: readonly LayoutFootnote[]) =>
    notes.length === 0 ? 0 : notes.reduce((sum, note) => sum + note.height, 0) + (footnoteSpace[pageOf(target)] ? 0 : FOOTNOTE_SEPARATOR_SPACE);
  const place = (target: number, notes: readonly LayoutFootnote[]) => {
    if (notes.length === 0) return;
    footnoteSpace[pageOf(target)] = (footnoteSpace[pageOf(target)] ?? 0) + demand(target, notes);
    for (const note of notes) footnotePages[note.index] = pageOf(target);
  };
  const fill = (bottom: number) => {
    if (columns > 1) slotHeights[slot] = Math.max(slotHeights[slot] ?? 0, bottom + shift - slotTop(frame, slot));
  };

  for (const box of boxes) {
    slot = Math.max(slot, slotAt(frame, box.top + shift));
    if (breakAfter !== null) {
      const { target } = breakAfter;
      push(box.breakPos, slotTop(frame, target) - (box.top + shift), false, target);
      slot = Math.max(slot, target);
      breakAfter = null;
    }

    const notes = box.footnotes ?? [];
    // Most boxes fit where they are; only look at lines when they do not, or carry footnotes.
    const fits = notes.length === 0 && box.bottom + shift <= limit(slot) + EPSILON;
    const lines = fits ? [] : (box.lines?.() ?? []);
    if (fits) {
      fill(box.bottom);
    } else if (lines.length === 0) {
      // Atomic blocks taller than a page stay where they are and overflow.
      while (box.bottom + shift > limit(slot) - demand(slot, notes) + EPSILON) {
        const top = box.top + shift;
        if (!(top > slotTop(frame, slot) + EPSILON && push(box.breakPos, slotTop(frame, slot + 1) - top, false, slot + 1))) break;
        slot += 1;
      }
      place(slot, notes);
      fill(box.bottom);
    } else {
      const lineNotes = notesByLine(lines, notes);
      // Only space after the last line hangs over the margin: each line has to fit.
      lines.forEach((line, index) => {
        const own = lineNotes[index]!;
        while (line.bottom + shift > limit(slot) - demand(slot, own) + EPSILON) {
          let moved: boolean;
          if (index === 0) {
            const top = box.top + shift;
            moved = top > slotTop(frame, slot) + EPSILON && push(box.breakPos, slotTop(frame, slot + 1) - top, false, slot + 1);
          } else {
            const top = line.top + shift;
            const carry = line.carry ?? 0;
            moved = top > slotTop(frame, slot) + EPSILON && push(line.start(), slotTop(frame, slot + 1) + carry - top, true, slot + 1, carry);
          }
          if (!moved) break;
          slot += 1;
        }
        place(slot, own);
        fill(line.bottom);
      });
    }

    if (box.pageBreak) breakAfter = { slot, target: (pageOf(slot) + 1) * columns };
    else if (box.columnBreak && columns > 1) breakAfter = { slot, target: slot + 1 };
    end = Math.max(end, box.bottom + shift);
  }

  let lastSlot = Math.max(slot, slotAt(frame, end - EPSILON));
  // A page break at the very end still starts a (blank) page, and a column break a column.
  if (breakAfter !== null) lastSlot = Math.max(lastSlot, breakAfter.target);
  const pageCount = pageOf(lastSlot) + 1;
  return { spacers, pageCount, footnotePages, ...(columns > 1 && { slotHeights, lastSlot }) };
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
