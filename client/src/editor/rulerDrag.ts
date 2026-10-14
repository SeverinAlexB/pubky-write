// Dragging the markers and margins of the horizontal ruler: snapping, limits, labels and the
// transactions that apply the result. Positions are in points; indents count from the margins.
import {
  indentAttributes,
  INDENT_STEP_PT,
  MAX_MARGIN_PT,
  paragraphIndents,
  pointsPerUnit,
  type LengthUnit,
} from "@docs/shared";
import { closeHistory } from "@tiptap/pm/history";
import type { Node } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";

export type RulerHandle = "leftIndent" | "firstLineIndent" | "rightIndent" | "marginLeft" | "marginRight";

/** The indents of a paragraph as the ruler shows them, in points. */
export type RulerIndents = {
  /** From the left margin, including the indent of the list levels the paragraph is in. */
  left: number;
  /** Where the first line starts, from the left margin (not from the left indent). */
  firstLine: number;
  /** From the right margin. */
  right: number;
};

/** The bullet or number of a list item sits 15pt (20px) before its text. */
export const LIST_GLYPH_OFFSET_PT = 15;
/** The text between the indents stays at least this wide, in points. */
const MIN_TEXT_WIDTH_PT = 36;
/** The writable area between the margins stays at least one inch wide. */
const MIN_WRITABLE_PT = 72;

const listTypes = new Set(["bulletList", "orderedList", "taskList"]);
const indentedTypes = new Set(["paragraph", "heading"]);

export const handleLabels: Record<RulerHandle, string> = {
  leftIndent: "Left indent",
  firstLineIndent: "First line indent",
  rightIndent: "Right indent",
  marginLeft: "Left margin",
  marginRight: "Right margin",
};

/** Values snap to quarter centimetres or eighths of an inch, like the ruler's ticks. */
export function snapStep(unit: LengthUnit): number {
  return pointsPerUnit(unit) / (unit === "in" ? 8 : 4);
}

export function snap(points: number, unit: LengthUnit): number {
  const step = snapStep(unit);
  return Math.round(points / step) * step;
}

/** "2.54 cm" or "1.25 in". */
export function formatLength(points: number, unit: LengthUnit): string {
  const value = Math.round((points / pointsPerUnit(unit)) * 100) / 100 || 0;
  return `${value.toFixed(2)} ${unit}`;
}

/** The text of the tooltip while dragging, such as "Left indent 2.54 cm". */
export function dragLabel(handle: RulerHandle, value: number, indents: RulerIndents, unit: LengthUnit): string {
  // The first line indent is shown from the left indent, as it is stored (negative when hanging).
  const shown = handle === "firstLineIndent" ? value - indents.left : value;
  return `${handleLabels[handle]} ${formatLength(shown, unit)}`;
}

/** Number of list levels around the block at `depth` of `$pos`'s path. */
function listDepth(state: EditorState, pos: number): number {
  const $pos = state.doc.resolve(pos);
  let lists = 0;
  for (let depth = $pos.depth; depth > 0; depth--) if (listTypes.has($pos.node(depth).type.name)) lists += 1;
  return lists;
}

function rulerIndentsOf(block: Node, lists: number): RulerIndents {
  const own = paragraphIndents(block.attrs);
  const left = lists * INDENT_STEP_PT + own.left;
  return { left, firstLine: left + own.firstLine - (lists > 0 ? LIST_GLYPH_OFFSET_PT : 0), right: own.right };
}

/** The indents of the paragraph at the cursor, or of the first paragraph in the selection. */
export function rulerIndents(state: EditorState): RulerIndents {
  const { $from, from, to } = state.selection;
  if ($from.parent.isTextblock) return rulerIndentsOf($from.parent, listDepth(state, $from.pos));
  // Select all, or a selected block: the first paragraph or heading in it.
  let found: RulerIndents | null = null;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (found) return false;
    if (!indentedTypes.has(node.type.name)) return true;
    found = rulerIndentsOf(node, listDepth(state, pos + 1));
    return false;
  });
  return found ?? { left: 0, firstLine: 0, right: 0 };
}

/**
 * The value of `handle` dragged to `points`, kept within the page. `indents` are the paragraph's
 * when the drag started; `contentWidth` is the width between the margins and `pageWidth` the
 * page's, in points.
 */
export function clampHandle(
  handle: RulerHandle,
  points: number,
  context: { indents: RulerIndents; contentWidth: number; pageWidth: number; margins: { left: number; right: number } },
): number {
  const { indents, contentWidth, pageWidth, margins } = context;
  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));
  const textEnd = contentWidth - indents.right - MIN_TEXT_WIDTH_PT;
  switch (handle) {
    case "leftIndent": {
      // The first line moves with the left indent, so a hanging first line must stay on the page too.
      const hanging = Math.min(indents.firstLine - indents.left, 0);
      return clamp(points, -hanging, textEnd - Math.max(indents.firstLine - indents.left, 0));
    }
    case "firstLineIndent":
      return clamp(points, 0, textEnd);
    case "rightIndent":
      return clamp(points, 0, contentWidth - Math.max(indents.left, indents.firstLine) - MIN_TEXT_WIDTH_PT);
    case "marginLeft":
      return clamp(points, 0, Math.min(MAX_MARGIN_PT, pageWidth - margins.right - MIN_WRITABLE_PT));
    case "marginRight":
      return clamp(points, 0, Math.min(MAX_MARGIN_PT, pageWidth - margins.left - MIN_WRITABLE_PT));
  }
}

/**
 * Sets the dragged indent on every paragraph and heading in the selection: `value` is where the
 * marker was dropped, in the ruler's terms (see RulerIndents). Dragging the left indent keeps each
 * paragraph's first line indent, so the first line moves with it.
 */
export function setIndentTransaction(state: EditorState, handle: "leftIndent" | "firstLineIndent" | "rightIndent", value: number): Transaction | null {
  // Each drag is an undo step of its own.
  const tr = closeHistory(state.tr);
  const { from, to } = state.selection;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!indentedTypes.has(node.type.name)) return;
    const lists = listDepth(state, pos + 1);
    const own = paragraphIndents(node.attrs);
    const current = rulerIndentsOf(node, lists);
    const next = { ...own };
    if (handle === "leftIndent") next.left = value - lists * INDENT_STEP_PT;
    if (handle === "firstLineIndent") next.firstLine = value - current.left + (lists > 0 ? LIST_GLYPH_OFFSET_PT : 0);
    if (handle === "rightIndent") next.right = value;
    const attrs = indentAttributes(next);
    if (Object.entries(attrs).every(([key, stored]) => node.attrs[key] === stored)) return;
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
  });
  return tr.docChanged ? tr : null;
}
