// Paragraph styles (Normal text, Title, Subtitle, Heading 1–6), as in Format > Paragraph styles.
//
// Headings are `heading` nodes with levels 1–6. Title and Subtitle are paragraphs with a
// `paragraphStyle` attribute, so documents saved before they existed (plain paragraphs and
// headings 1–3) load unchanged.
import { Extension } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";

export type ParagraphStyleId = "normal" | "title" | "subtitle" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

export type ParagraphStyleDefinition = {
  /** Font size in points. */
  fontSize: number;
  color: string;
  italic: boolean;
  /** Space before and after the paragraph in points. */
  spaceBefore: number;
  spaceAfter: number;
};

/** The look of each style (the editor's CSS uses the same numbers). */
export const paragraphStyleDefinitions: Record<ParagraphStyleId, ParagraphStyleDefinition> = {
  normal: { fontSize: 11, color: "#000000", italic: false, spaceBefore: 0, spaceAfter: 0 },
  title: { fontSize: 26, color: "#000000", italic: false, spaceBefore: 0, spaceAfter: 3 },
  subtitle: { fontSize: 15, color: "#666666", italic: false, spaceBefore: 0, spaceAfter: 16 },
  h1: { fontSize: 20, color: "#000000", italic: false, spaceBefore: 20, spaceAfter: 6 },
  h2: { fontSize: 16, color: "#000000", italic: false, spaceBefore: 18, spaceAfter: 6 },
  h3: { fontSize: 14, color: "#434343", italic: false, spaceBefore: 16, spaceAfter: 4 },
  h4: { fontSize: 12, color: "#666666", italic: false, spaceBefore: 14, spaceAfter: 4 },
  h5: { fontSize: 11, color: "#666666", italic: false, spaceBefore: 12, spaceAfter: 4 },
  h6: { fontSize: 11, color: "#666666", italic: true, spaceBefore: 12, spaceAfter: 4 },
};

export const headingLevels = [1, 2, 3, 4, 5, 6] as const;

/** The paragraph style of a text block. Blocks other than paragraphs and headings count as Normal text. */
export function paragraphStyleOf(block: Node): ParagraphStyleId {
  if (block.type.name === "heading") return `h${block.attrs.level}` as ParagraphStyleId;
  if (block.type.name === "paragraph" && (block.attrs.paragraphStyle === "title" || block.attrs.paragraphStyle === "subtitle")) {
    return block.attrs.paragraphStyle;
  }
  return "normal";
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    paragraphStyle: {
      /** Applies a style to every text block in the selection, keeping character formatting. */
      setParagraphStyle: (style: ParagraphStyleId) => ReturnType;
    };
  }
}

export const ParagraphStyle = Extension.create({
  name: "paragraphStyle",
  // Before the paragraph and heading extensions, so ⌘+Option+0…6 apply styles instead of toggling them.
  priority: 110,

  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          paragraphStyle: {
            default: null,
            parseHTML: (element) => {
              const style = element.getAttribute("data-paragraph-style");
              return style === "title" || style === "subtitle" ? style : null;
            },
            renderHTML: (attributes) =>
              attributes.paragraphStyle ? { "data-paragraph-style": attributes.paragraphStyle } : {},
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setParagraphStyle:
        (style) =>
        ({ commands }) => {
          // A new style brings its own spacing, so custom spacing is reset.
          const reset = { spaceBefore: null, spaceAfter: null };
          if (style.startsWith("h")) return commands.setNode("heading", { ...reset, level: Number(style.slice(1)) });
          return commands.setNode("paragraph", { ...reset, paragraphStyle: style === "normal" ? null : style });
        },
    };
  },

  addKeyboardShortcuts() {
    const shortcuts: Record<string, () => boolean> = {
      "Mod-Alt-0": () => this.editor.commands.setParagraphStyle("normal"),
    };
    for (const level of headingLevels) {
      shortcuts[`Mod-Alt-${level}`] = () => this.editor.commands.setParagraphStyle(`h${level}`);
    }
    return shortcuts;
  },
});
