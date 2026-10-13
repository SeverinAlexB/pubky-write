// Paragraph-level line spacing, space before and after, and indentation, like
// Format > Line & paragraph spacing and Format > Align & indent. All are attributes of
// paragraphs and headings.
import { Extension } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { paragraphStyleDefinitions, paragraphStyleOf } from "./paragraphStyles.ts";

export const lineSpacings = [1, 1.15, 1.5, 2] as const;
export const DEFAULT_LINE_SPACING = 1.15;
export const MAX_INDENT = 8;
/** One indent step is half an inch, as in the reference product. */
export const INDENT_STEP_PX = 48;
/** What "Add space before/after paragraph" adds, in points. */
export const SPACE_STEP_PT = 10;
export const MAX_PARAGRAPH_SPACE_PT = 1000;

const formattedTypes = ["paragraph", "heading"];

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
          indent: {
            default: 0,
            parseHTML: (element) => {
              const level = Math.round(Number.parseFloat(element.style.marginLeft) / INDENT_STEP_PX);
              return Number.isFinite(level) ? Math.min(Math.max(level, 0), MAX_INDENT) : 0;
            },
            renderHTML: (attributes) =>
              attributes.indent ? { style: `margin-left: ${attributes.indent * INDENT_STEP_PX}px` } : {},
          },
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
            const indent = Math.min(Math.max((node.attrs.indent ?? 0) + step, 0), MAX_INDENT);
            if (indent === node.attrs.indent) return;
            tr.setNodeAttribute(pos, "indent", indent);
            changed = true;
          });
          if (changed) dispatch?.(tr);
          return changed;
        },
    };
  },
});
