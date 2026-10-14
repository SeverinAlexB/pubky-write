import { describe, expect, it } from "vitest";
import {
  contentBottom,
  contentTop,
  FOOTNOTE_SEPARATOR_SPACE,
  paginate,
  sameSpacers,
  type LayoutBox,
  type PageFrame,
} from "./pageLayout.ts";

// A4 at 96 dpi with 2.54 cm margins: the writable area of page 1 is 96–1027.
const a4: PageFrame = { pageHeight: 1123, gap: 10, marginTop: 96, marginBottom: 96 };
const LINE = 17;

/** A paragraph of `count` lines starting at `top`, whose line i starts at position `pos + i * 10`. */
function paragraph(top: number, count: number, pos: number): LayoutBox {
  const lines = Array.from({ length: count }, (_, i) => ({
    top: top + i * LINE,
    bottom: top + (i + 1) * LINE,
    start: () => pos + i * 10,
  }));
  return { top, bottom: top + count * LINE, breakPos: pos - 1, lines: () => lines };
}

describe("paginate", () => {
  it("keeps content that fits on one page", () => {
    expect(paginate([paragraph(96, 10, 1)], a4)).toEqual({ spacers: [], pageCount: 1, footnotePages: [] });
    expect(paginate([], a4).pageCount).toBe(1);
  });

  it("continues the line that does not fit at the top margin of the next page", () => {
    // 60 lines from 96 reach 1116; 54 lines fit above 1027.
    const { spacers, pageCount } = paginate([paragraph(96, 60, 1)], a4);
    expect(pageCount).toBe(2);
    expect(spacers).toHaveLength(1);
    const [spacer] = spacers;
    expect(spacer).toMatchObject({ pos: 1 + 54 * 10, inline: true });
    // Line 54 started at 96 + 54 × 17 = 1014 and moves to page 2's top margin, 1133 + 96.
    expect(1014 + spacer!.shift).toBe(contentTop(a4, 1));
  });

  it("breaks a long paragraph over several pages", () => {
    const { spacers, pageCount } = paginate([paragraph(96, 150, 1)], a4);
    expect(pageCount).toBe(3);
    expect(spacers.map((spacer) => spacer.inline)).toEqual([true, true]);
    // Each page holds 54 lines.
    expect(spacers.map((spacer) => spacer.pos)).toEqual([541, 1081]);
  });

  it("moves a block that starts below the last line that fits as a whole", () => {
    const image: LayoutBox = { top: 900, bottom: 1200, breakPos: 40 };
    const { spacers, pageCount } = paginate([paragraph(96, 47, 1), image], a4);
    expect(spacers).toEqual([{ pos: 40, shift: contentTop(a4, 1) - 900, inline: false }]);
    expect(pageCount).toBe(2);
  });

  it("moves a paragraph whose first line does not fit", () => {
    const { spacers } = paginate([paragraph(96, 54, 1), paragraph(1014, 3, 600)], a4);
    expect(spacers).toEqual([{ pos: 599, shift: contentTop(a4, 1) - 1014, inline: false }]);
  });

  it("leaves a block taller than a page at the top of its page and continues below it", () => {
    const tall: LayoutBox = { top: 96, bottom: 2000, breakPos: 0 };
    const { spacers, pageCount } = paginate([tall, paragraph(2000, 1, 10), paragraph(2017, 5, 20)], a4);
    expect(spacers).toEqual([]);
    expect(pageCount).toBe(2);
  });

  it("starts the content after a page break on the next page", () => {
    const pageBreak: LayoutBox = { top: 113, bottom: 113, breakPos: 3, pageBreak: true };
    const { spacers, pageCount } = paginate([paragraph(96, 1, 1), pageBreak, paragraph(113, 1, 5)], a4);
    expect(spacers).toEqual([{ pos: 4, shift: contentTop(a4, 1) - 113, inline: false }]);
    expect(pageCount).toBe(2);
  });

  it("counts a page break at the end as a new page", () => {
    const pageBreak: LayoutBox = { top: 113, bottom: 113, breakPos: 3, pageBreak: true };
    expect(paginate([paragraph(96, 1, 1), pageBreak], a4).pageCount).toBe(2);
  });

  it("lets space after the last line hang into the margin", () => {
    const box = { ...paragraph(96, 54, 1), bottom: 96 + 54 * LINE + 20 };
    expect(paginate([box], a4)).toEqual({ spacers: [], pageCount: 1, footnotePages: [] });
  });

  it("gives the bottom of the writable area", () => {
    expect(contentBottom(a4, 0)).toBe(1027);
    expect(contentTop(a4, 1)).toBe(1229);
  });
});

describe("sameSpacers", () => {
  it("ignores differences below half a pixel", () => {
    expect(sameSpacers([{ pos: 1, shift: 10, inline: true }], [{ pos: 1, shift: 10.2, inline: true }])).toBe(true);
    expect(sameSpacers([{ pos: 1, shift: 10, inline: true }], [{ pos: 2, shift: 10, inline: true }])).toBe(false);
  });

  it("reserves room for footnotes at the bottom of their reference's page", () => {
    // 54 lines fit on a page without footnotes. A 40px footnote on line 10 takes 60px with the separator,
    // so only lines whose bottom is at most 1027 - 60 = 967 stay: 51 lines.
    const box = paragraph(96, 60, 1);
    box.footnotes = [{ index: 0, top: 96 + 10 * LINE, bottom: 96 + 11 * LINE, height: 40 }];
    const { spacers, footnotePages } = paginate([box], a4);
    expect(footnotePages).toEqual([0]);
    expect(spacers[0]).toMatchObject({ pos: 1 + 51 * 10, inline: true });
    expect(96 + 52 * LINE + 40 + FOOTNOTE_SEPARATOR_SPACE).toBeGreaterThan(contentBottom(a4, 0));
  });

  it("moves a line to the next page with its footnote when the footnote does not fit", () => {
    // Line 53 (bottom 1014) fits, but not with a 30px footnote and the separator.
    const box = paragraph(96, 55, 1);
    box.footnotes = [
      { index: 0, top: 96, bottom: 96 + LINE, height: 20 },
      { index: 1, top: 96 + 53 * LINE, bottom: 96 + 54 * LINE, height: 30 },
    ];
    const { spacers, footnotePages } = paginate([box], a4);
    expect(footnotePages).toEqual([0, 1]);
    // Room left with the first footnote: 1027 - 40 = 987, so 52 lines stay on page 1.
    expect(spacers[0]).toMatchObject({ pos: 1 + 52 * 10, inline: true });
  });

  it("uses the first page's own margins", () => {
    const frame: PageFrame = { ...a4, firstMarginTop: 150, firstMarginBottom: 200 };
    expect(contentTop(frame, 0)).toBe(150);
    expect(contentBottom(frame, 0)).toBe(1123 - 200);
    expect(contentTop(frame, 1)).toBe(1133 + 96);
    // From 150, lines fit above 923: 45 lines.
    const { spacers } = paginate([paragraph(150, 50, 1)], frame);
    expect(spacers[0]).toMatchObject({ pos: 1 + 45 * 10 });
  });
});

describe("paginate with columns", () => {
  const twoColumns: PageFrame = { ...a4, columns: 2 };
  const stride = 1133;

  it("fills the first column, then the second, then the next page", () => {
    // 54 lines fit in a column: 150 lines take columns 1 and 2 of page 1 and part of page 2.
    const { spacers, pageCount, slotHeights } = paginate([paragraph(96, 150, 1)], twoColumns);
    expect(pageCount).toBe(2);
    expect(spacers.map(({ pos, from, to }) => ({ pos, from, to }))).toEqual([
      { pos: 541, from: 0, to: 1 },
      { pos: 1081, from: 1, to: 2 },
    ]);
    // Column 2 is laid out as its own page in the strip: its first line starts at the top margin.
    expect(96 + 54 * LINE + spacers[0]!.shift).toBe(stride + 96);
    expect(slotHeights).toEqual([54 * LINE, 54 * LINE, 42 * LINE]);
  });

  it("moves the content after a column break to the next column, and after a page break to the next page", () => {
    const columnBreak: LayoutBox = { top: 96 + 3 * LINE, bottom: 96 + 3 * LINE, breakPos: 30, columnBreak: true };
    const pageBreak: LayoutBox = { top: 96 + 5 * LINE, bottom: 96 + 5 * LINE, breakPos: 60, pageBreak: true };
    const { spacers, pageCount } = paginate(
      [paragraph(96, 3, 1), columnBreak, paragraph(96 + 3 * LINE, 2, 31), pageBreak, paragraph(96 + 5 * LINE, 1, 61)],
      twoColumns,
    );
    expect(spacers.map(({ pos, from, to }) => ({ pos, from, to }))).toEqual([
      { pos: 30, from: 0, to: 1 },
      { pos: 60, from: 1, to: 2 },
    ]);
    expect(pageCount).toBe(2);
  });

  it("starts the next page after a page break in the first column", () => {
    const pageBreak: LayoutBox = { top: 96 + LINE, bottom: 96 + LINE, breakPos: 20, pageBreak: true };
    const { spacers } = paginate([paragraph(96, 1, 1), pageBreak, paragraph(96 + LINE, 1, 21)], twoColumns);
    expect(spacers[0]).toMatchObject({ pos: 20, from: 0, to: 2 });
    expect(96 + LINE + spacers[0]!.shift).toBe(stride * 2 + 96);
  });

  it("ignores column breaks with one column", () => {
    const columnBreak: LayoutBox = { top: 96 + 3 * LINE, bottom: 96 + 3 * LINE, breakPos: 30, columnBreak: true };
    expect(paginate([paragraph(96, 3, 1), columnBreak, paragraph(96 + 3 * LINE, 2, 31)], a4).spacers).toEqual([]);
  });

  it("keeps the content of every column in the page's footnote area", () => {
    const box = paragraph(96, 60, 1);
    box.footnotes = [{ index: 0, top: 96, bottom: 96 + LINE, height: 100 }];
    const { spacers, footnotePages } = paginate([box], twoColumns);
    expect(footnotePages).toEqual([0]);
    // 1027 - 120 leaves room for 47 lines in the first column.
    expect(spacers[0]).toMatchObject({ pos: 1 + 47 * 10, from: 0, to: 1 });
  });
});

describe("paginate tables", () => {
  /** A table of `count` rows of 30px from `top`; rows after the first `pinned` repeat those above them. */
  function table(top: number, count: number, pinned: number): LayoutBox {
    const rows = Array.from({ length: count }, (_, i) => ({
      top: top + i * 30,
      bottom: top + (i + 1) * 30,
      start: () => 1000 + i * 10,
      ...(i >= pinned && pinned > 0 && { carry: pinned * 30 }),
    }));
    return { top, bottom: top + count * 30, breakPos: 999, lines: () => rows };
  }

  it("breaks a table between rows and leaves room for the repeated header rows", () => {
    // 31 rows of 30px fit between 96 and 1027.
    const { spacers, pageCount } = paginate([table(96, 40, 1)], a4);
    expect(pageCount).toBe(2);
    expect(spacers).toHaveLength(1);
    expect(spacers[0]).toMatchObject({ pos: 1000 + 31 * 10, inline: true, carry: 30 });
    // The moved row starts below the repeated header row on page 2.
    expect(96 + 31 * 30 + spacers[0]!.shift).toBe(contentTop(a4, 1) + 30);
  });

  it("moves no header row along with a table without pinned rows", () => {
    const { spacers } = paginate([table(96, 40, 0)], a4);
    expect(spacers[0]).toEqual({ pos: 1000 + 31 * 10, shift: contentTop(a4, 1) - (96 + 31 * 30), inline: true });
  });
});
