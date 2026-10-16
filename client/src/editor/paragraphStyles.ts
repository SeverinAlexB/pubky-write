import { paragraphStyleOf, type ParagraphStyleId } from "@pubky-write/shared";
import type { Node } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";
import type { CSSProperties } from "react";
import type { ShortcutId } from "../shortcuts.ts";

export type ParagraphStyle = {
  id: ParagraphStyleId;
  label: string;
  shortcut?: ShortcutId;
  /** Listed in the toolbar's Styles menu; Heading 4–6 are only in Format > Paragraph styles. */
  inToolbar: boolean;
  /** How the style's name is drawn in menus: the style itself, scaled to fit. */
  preview: CSSProperties;
};

/** The paragraph styles in menu order. Adding a style here adds it to the toolbar and the Format menu. */
export const paragraphStyles: ParagraphStyle[] = [
  { id: "normal", label: "Normal text", shortcut: "normalText", inToolbar: true, preview: { fontSize: 14 } },
  { id: "title", label: "Title", inToolbar: true, preview: { fontSize: 28 } },
  { id: "subtitle", label: "Subtitle", inToolbar: true, preview: { fontSize: 18, color: "#666666" } },
  { id: "h1", label: "Heading 1", shortcut: "heading1", inToolbar: true, preview: { fontSize: 26 } },
  { id: "h2", label: "Heading 2", shortcut: "heading2", inToolbar: true, preview: { fontSize: 22 } },
  { id: "h3", label: "Heading 3", shortcut: "heading3", inToolbar: true, preview: { fontSize: 18, color: "#434343" } },
  { id: "h4", label: "Heading 4", shortcut: "heading4", inToolbar: false, preview: { fontSize: 16, color: "#666666" } },
  { id: "h5", label: "Heading 5", shortcut: "heading5", inToolbar: false, preview: { fontSize: 14, color: "#666666" } },
  {
    id: "h6",
    label: "Heading 6",
    shortcut: "heading6",
    inToolbar: false,
    preview: { fontSize: 14, color: "#666666", fontStyle: "italic" },
  },
];

export function applyParagraphStyle(editor: Editor, style: ParagraphStyle): void {
  editor.chain().focus().setParagraphStyle(style.id).run();
}

/** The style of every text block in the selection, or null when they differ. */
export function currentParagraphStyle(editor: Editor): ParagraphStyle | null {
  const { from, to } = editor.state.selection;
  const found = new Set<ParagraphStyle | undefined>();
  editor.state.doc.nodesBetween(from, to, (node: Node) => {
    if (!node.isTextblock) return true;
    found.add(paragraphStyles.find((style) => style.id === paragraphStyleOf(node)));
    return false;
  });
  return found.size === 1 ? ([...found][0] ?? null) : null;
}
