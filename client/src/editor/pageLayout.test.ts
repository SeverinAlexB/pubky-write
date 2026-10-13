import { describe, expect, it } from "vitest";
import { contentBottom, contentTop, paginate, sameSpacers, type LayoutBox, type PageFrame } from "./pageLayout.ts";

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
    expect(paginate([paragraph(96, 10, 1)], a4)).toEqual({ spacers: [], pageCount: 1 });
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
    expect(paginate([box], a4)).toEqual({ spacers: [], pageCount: 1 });
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
});
