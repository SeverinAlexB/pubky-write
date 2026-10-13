// Paragraph-level line spacing and indentation, like Format > Line & paragraph spacing
// and Format > Align & indent in the reference product. Both are attributes of paragraphs and headings.
import { Extension } from "@tiptap/core";

export const lineSpacings = [1, 1.15, 1.5, 2] as const;
export const DEFAULT_LINE_SPACING = 1.15;
export const MAX_INDENT = 8;
/** One indent step is half an inch, as in the reference product. */
export const INDENT_STEP_PX = 48;

const formattedTypes = ["paragraph", "heading"];

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    paragraphFormat: {
      setLineSpacing: (spacing: number) => ReturnType;
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
