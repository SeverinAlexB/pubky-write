import type { Node } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";
import type { CSSProperties } from "react";

export type ParagraphStyle = {
  id: string;
  label: string;
  /** Written as on macOS, see shortcut(). */
  shortcut?: string;
  /** Listed in the toolbar's Styles menu; Heading 4–6 are only in Format > Paragraph styles. */
  inToolbar: boolean;
  /** How the style's name is drawn in menus: the style itself, scaled to fit. */
  preview: CSSProperties;
  matches: (block: Node) => boolean;
  apply: (editor: Editor) => void;
};

function heading(level: 1 | 2 | 3) {
  return {
    matches: (block: Node) => block.type.name === "heading" && block.attrs.level === level,
    apply: (editor: Editor) => editor.chain().focus().setHeading({ level }).run(),
  };
}

/** The paragraph styles in menu order. Adding a style here adds it to the toolbar and the Format menu. */
export const paragraphStyles: ParagraphStyle[] = [
  {
    id: "normal",
    label: "Normal text",
    shortcut: "⌘+Option+0",
    inToolbar: true,
    preview: { fontSize: 14 },
    matches: (block) => block.type.name === "paragraph",
    apply: (editor) => editor.chain().focus().setParagraph().run(),
  },
  { id: "h1", label: "Heading 1", shortcut: "⌘+Option+1", inToolbar: true, preview: { fontSize: 26 }, ...heading(1) },
  { id: "h2", label: "Heading 2", shortcut: "⌘+Option+2", inToolbar: true, preview: { fontSize: 22 }, ...heading(2) },
  {
    id: "h3",
    label: "Heading 3",
    shortcut: "⌘+Option+3",
    inToolbar: true,
    preview: { fontSize: 18, color: "#434343" },
    ...heading(3),
  },
];

/** The style of every text block in the selection, or null when they differ. */
export function currentParagraphStyle(editor: Editor): ParagraphStyle | null {
  const { from, to } = editor.state.selection;
  const found = new Set<ParagraphStyle | undefined>();
  editor.state.doc.nodesBetween(from, to, (node) => {
    if (!node.isTextblock) return true;
    found.add(paragraphStyles.find((style) => style.matches(node)));
    return false;
  });
  return found.size === 1 ? ([...found][0] ?? null) : null;
}
