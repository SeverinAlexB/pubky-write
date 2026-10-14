// Paragraph indents in points (Format > Align & indent, Tab and ⌘], the ruler). Kept apart
// from the paragraph attributes in paragraphFormat.ts so that code that only reads documents
// (the document list's thumbnails) does not load the editor framework.

export const MAX_INDENT = 8;
/** One indent step (Tab, ⌘]) is half an inch. */
export const INDENT_STEP_PT = 36;
/** Indents stay within this many points (22 inches) either way. */
export const MAX_INDENT_PT = 1584;

/**
 * A paragraph's indents in points: `left` from the left margin, `firstLine` from the left indent
 * (negative for a hanging indent), `right` from the right margin.
 *
 * They are stored as `indentLeft`, `indentFirstLine` and `indentRight`. Documents saved before
 * those existed have only `indent`, a number of half-inch steps; it still counts towards the left
 * indent, so they look the same. Every change writes the whole left indent to `indentLeft` and
 * sets `indent` to 0.
 */
export type ParagraphIndents = { left: number; firstLine: number; right: number };

export function paragraphIndents(attrs: Record<string, unknown>): ParagraphIndents {
  const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  return {
    left: number(attrs.indent) * INDENT_STEP_PT + number(attrs.indentLeft),
    firstLine: number(attrs.indentFirstLine),
    right: number(attrs.indentRight),
  };
}

/** The attributes that store `indents` (rounded to hundredths of a point). */
export function indentAttributes(indents: ParagraphIndents) {
  const round = (points: number) => Math.round(Math.min(Math.max(points, -MAX_INDENT_PT), MAX_INDENT_PT) * 100) / 100 || 0;
  return { indent: 0, indentLeft: round(indents.left), indentFirstLine: round(indents.firstLine), indentRight: round(indents.right) };
}

/** The left indent after Tab or ⌘] (`step` 1) or Shift+Tab or ⌘[ (-1): the next half-inch stop. */
export function steppedIndent(left: number, step: 1 | -1): number {
  const stops = left / INDENT_STEP_PT;
  if (step > 0) return Math.max(left, Math.min(Math.floor(stops + 1e-6) + 1, MAX_INDENT) * INDENT_STEP_PT);
  return Math.max(Math.ceil(stops - 1e-6) - 1, 0) * INDENT_STEP_PT;
}

