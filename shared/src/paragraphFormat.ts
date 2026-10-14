// Paragraph-level line spacing, space before and after, and indentation, like
// Format > Line & paragraph spacing and Format > Align & indent. All are attributes of
// paragraphs and headings.
import { Extension } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { indentAttributes, MAX_INDENT_PT, paragraphIndents, steppedIndent, type ParagraphIndents } from "./indents.ts";
import { paragraphStyleDefinitions, paragraphStyleOf } from "./paragraphStyles.ts";

export const lineSpacings = [1, 1.15, 1.5, 2] as const;
export const DEFAULT_LINE_SPACING = 1.15;
/** One indent step (Tab, ⌘]) on screen: half an inch. */
export const INDENT_STEP_PX = 48;
/** What "Add space before/after paragraph" adds, in points. */
export const SPACE_STEP_PT = 10;
export const MAX_PARAGRAPH_SPACE_PT = 1000;

const formattedTypes = ["paragraph", "heading"];

function indentStyle(attributes: Record<string, unknown>): string {
  const { left, firstLine, right } = paragraphIndents(attributes);
  return [
    left ? `margin-left: ${left}pt` : "",
    firstLine ? `text-indent: ${firstLine}pt` : "",
    right ? `margin-right: ${right}pt` : "",
  ]
    .filter(Boolean)
    .join("; ");
}

/** A CSS length in px or pt (as pasted from this editor or elsewhere) in points. */
function cssPoints(value: string): number | null {
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)(px|pt)$/);
  if (!match) return null;
  const points = match[2] === "px" ? (Number(match[1]) * 72) / 96 : Number(match[1]);
  return Math.min(Math.max(Math.round(points * 100) / 100, -MAX_INDENT_PT), MAX_INDENT_PT);
}

function indentAttribute(css: string) {
  return {
    default: 0,
    parseHTML: (element: HTMLElement) => cssPoints(element.style.getPropertyValue(css)) ?? 0,
    // Rendered together by the `indent` attribute.
    renderHTML: () => ({}),
    validate: (value: unknown) => {
      if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > MAX_INDENT_PT) {
        throw new RangeError(`Invalid indent ${String(value)}`);
      }
    },
  };
}

export type ParagraphSpacing = { lineSpacing?: number; spaceBefore?: number; spaceAfter?: number };
type SpaceSide = "spaceBefore" | "spaceAfter";

/** The space before or after a block in points: its own value, or else its paragraph style's. */
export function paragraphSpace(block: Node, side: SpaceSide): number {
  const explicit = block.attrs[side] as number | null | undefined;
  return explicit ?? paragraphStyleDefinitions[paragraphStyleOf(block)][side];
}

/** Stored as null when it matches the style, so a later style change is not held back by an old value. */
function storedSpace(block: Node, side: SpaceSide, points: number): number | null {
  const value = Math.min(Math.max(Math.round(points * 10) / 10, 0), MAX_PARAGRAPH_SPACE_PT);
  return value === paragraphStyleDefinitions[paragraphStyleOf(block)][side] ? null : value;
}

function spaceAttribute(side: SpaceSide, css: string) {
  return {
    default: null,
    parseHTML: (element: HTMLElement) => {
      const match = element.style.getPropertyValue(css).match(/^(\d+(?:\.\d+)?)pt$/);
      return match ? Number(match[1]) : null;
    },
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes[side] === null || attributes[side] === undefined ? {} : { style: `${css}: ${attributes[side]}pt` },
  };
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    paragraphFormat: {
      setLineSpacing: (spacing: number) => ReturnType;
      /** Sets the given spacing values on every paragraph in the selection (Custom spacing). */
      setParagraphSpacing: (spacing: ParagraphSpacing) => ReturnType;
      /** Add space before/after paragraph, or remove it when the first selected paragraph has some. */
      toggleParagraphSpace: (side: SpaceSide) => ReturnType;
      /** Indents (or with a negative step, outdents) every paragraph in the selection. */
      changeIndent: (step: 1 | -1) => ReturnType;
      /** Sets the given indents (in points, as stored) on every paragraph in the selection. */
      setParagraphIndents: (indents: Partial<ParagraphIndents>) => ReturnType;
    };
  }
}

export const ParagraphFormat = Extension.create({
  name: "paragraphFormat",

  addGlobalAttributes() {
    return [
      {
        types: formattedTypes,
        attributes: {
          lineSpacing: {
            default: null,
            parseHTML: (element) => {
              const value = Number.parseFloat(element.style.lineHeight);
              return Number.isFinite(value) && value > 0 ? value : null;
            },
            renderHTML: (attributes) =>
              attributes.lineSpacing ? { style: `line-height: ${attributes.lineSpacing}` } : {},
          },
          // Space before and after in points; null means the paragraph style's spacing.
          spaceBefore: spaceAttribute("spaceBefore", "padding-top"),
          spaceAfter: spaceAttribute("spaceAfter", "padding-bottom"),
          // Half-inch steps, from documents saved before the indents in points (see paragraphIndents).
          // Pasted HTML has the whole left indent in `margin-left`, which goes to indentLeft.
          indent: {
            default: 0,
            parseHTML: () => 0,
            renderHTML: (attributes) => {
              const style = indentStyle(attributes);
              return style ? { style } : {};
            },
          },
          indentLeft: indentAttribute("margin-left"),
          indentFirstLine: indentAttribute("text-indent"),
          indentRight: indentAttribute("margin-right"),
        },
      },
    ];
  },

  addCommands() {
    return {
      setLineSpacing:
        (spacing) =>
        ({ tr, state, dispatch }) => {
          const value = spacing === DEFAULT_LINE_SPACING ? null : spacing;
          let changed = false;
          state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
            if (!formattedTypes.includes(node.type.name)) return;
            tr.setNodeAttribute(pos, "lineSpacing", value);
            changed = true;
          });
          if (changed) dispatch?.(tr);
          return changed;
        },
      setParagraphSpacing:
        (spacing) =>
        ({ tr, state, dispatch }) => {
          let changed = false;
          state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
            if (!formattedTypes.includes(node.type.name)) return;
            const attrs = { ...node.attrs };
            if (spacing.lineSpacing !== undefined) {
              attrs.lineSpacing = spacing.lineSpacing === DEFAULT_LINE_SPACING ? null : spacing.lineSpacing;
            }
            if (spacing.spaceBefore !== undefined) attrs.spaceBefore = storedSpace(node, "spaceBefore", spacing.spaceBefore);
            if (spacing.spaceAfter !== undefined) attrs.spaceAfter = storedSpace(node, "spaceAfter", spacing.spaceAfter);
            tr.setNodeMarkup(pos, undefined, attrs);
            changed = true;
          });
          if (changed) dispatch?.(tr);
          return changed;
        },
      toggleParagraphSpace:
        (side) =>
        ({ state, commands }) => {
          let first: Node | undefined;
          state.doc.nodesBetween(state.selection.from, state.selection.to, (node) => {
            if (formattedTypes.includes(node.type.name)) first ??= node;
          });
          if (!first) return false;
          return commands.setParagraphSpacing({ [side]: paragraphSpace(first, side) > 0 ? 0 : SPACE_STEP_PT });
        },
      changeIndent:
        (step) =>
        ({ tr, state, dispatch }) => {
          let changed = false;
          state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
            if (!formattedTypes.includes(node.type.name)) return;
            const indents = paragraphIndents(node.attrs);
            const left = steppedIndent(indents.left, step);
            if (left === indents.left) return;
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...indentAttributes({ ...indents, left }) });
            changed = true;
          });
          if (changed) dispatch?.(tr);
          return changed;
        },
      setParagraphIndents:
        (change) =>
        ({ tr, state, dispatch }) => {
          let changed = false;
          state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
            if (!formattedTypes.includes(node.type.name)) return;
            const indents = indentAttributes({ ...paragraphIndents(node.attrs), ...change });
            if (Object.entries(indents).every(([key, value]) => node.attrs[key] === value)) return;
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...indents });
            changed = true;
          });
          if (changed) dispatch?.(tr);
          return changed;
        },
    };
  },
});
