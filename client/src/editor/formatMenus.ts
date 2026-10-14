import { DEFAULT_LINE_SPACING, lineSpacings, paragraphSpace } from "@docs/shared";
import type { Editor } from "@tiptap/react";
import type { MenuEntry, MenuItem } from "../components/MenuList.tsx";
import { shortcut } from "../components/shortcuts.ts";
import type { EditorActions } from "./actions.ts";
import { changeFontSize } from "./extensions.ts";
import { paragraphStyles, type ParagraphStyle } from "./paragraphStyles.ts";
import { styleEntry } from "./toolbar/TextControls.tsx";

export function lineSpacingLabel(spacing: number): string {
  if (spacing === 1) return "Single";
  if (spacing === 2) return "Double";
  return String(spacing);
}

/** Line spacing and space before and after (in points) of the paragraph at the cursor. */
export type ParagraphSpacingState = { lineSpacing: number; spaceBefore: number; spaceAfter: number };

export function paragraphSpacingAt(editor: Editor): ParagraphSpacingState {
  const block = editor.state.selection.$from.parent;
  return {
    lineSpacing: (block.attrs.lineSpacing as number | null | undefined) ?? DEFAULT_LINE_SPACING,
    spaceBefore: paragraphSpace(block, "spaceBefore"),
    spaceAfter: paragraphSpace(block, "spaceAfter"),
  };
}

/** Format > Line & paragraph spacing, also opened from the toolbar. */
export function lineSpacingEntries(editor: Editor, actions: EditorActions, current: ParagraphSpacingState): MenuEntry[] {
  return [
    ...lineSpacings.map((spacing) => ({
      label: lineSpacingLabel(spacing),
      checked: current.lineSpacing === spacing,
      onSelect: () => editor.chain().focus().setLineSpacing(spacing).run(),
    })),
    "separator",
    {
      label: current.spaceBefore > 0 ? "Remove space before paragraph" : "Add space before paragraph",
      onSelect: actions.toggleSpaceBefore,
    },
    {
      label: current.spaceAfter > 0 ? "Remove space after paragraph" : "Add space after paragraph",
      onSelect: actions.toggleSpaceAfter,
    },
    "separator",
    { label: "Custom spacing…", onSelect: actions.customSpacing },
    "separator",
    { label: "Keep with next", checked: false, onSelect: actions.toggleKeepWithNext },
    { label: "Keep lines together", checked: false, onSelect: actions.toggleKeepLinesTogether },
    { label: "Prevent single lines", checked: false, onSelect: actions.togglePreventSingleLines },
    { label: "Add page break before", checked: false, onSelect: actions.togglePageBreakBefore },
  ];
}

/** Format > Text, also under Format options in the right-click menu. */
export function textMenu(editor: Editor, actions: EditorActions): MenuItem {
  const run = () => editor.chain().focus();
  const capitalise = actions.setCapitalisation;
  return {
    label: "Text",
    icon: "format_bold",
    submenu: [
      { label: "Bold", icon: "format_bold", shortcut: shortcut("⌘B"), onSelect: () => run().toggleBold().run() },
      { label: "Italic", icon: "format_italic", shortcut: shortcut("⌘I"), onSelect: () => run().toggleItalic().run() },
      {
        label: "Underline",
        icon: "format_underlined",
        shortcut: shortcut("⌘U"),
        onSelect: () => run().toggleUnderline().run(),
      },
      {
        label: "Strikethrough",
        icon: "strikethrough_s",
        shortcut: shortcut("⌘+Shift+X"),
        onSelect: () => run().toggleStrike().run(),
      },
      { label: "Superscript", icon: "superscript", shortcut: shortcut("⌘."), onSelect: actions.toggleSuperscript },
      { label: "Subscript", icon: "subscript", shortcut: shortcut("⌘,"), onSelect: actions.toggleSubscript },
      "separator",
      {
        label: "Size",
        icon: "format_size",
        submenu: [
          { label: "Increase font size", shortcut: shortcut("⌘+Shift+."), onSelect: () => changeFontSize(editor, 1) },
          { label: "Decrease font size", shortcut: shortcut("⌘+Shift+,"), onSelect: () => changeFontSize(editor, -1) },
        ],
      },
      {
        label: "Capitalisation",
        icon: "text_format",
        submenu: [
          { label: "lowercase", onSelect: capitalise && (() => capitalise("lowercase")) },
          { label: "UPPERCASE", onSelect: capitalise && (() => capitalise("uppercase")) },
          { label: "Title Case", onSelect: capitalise && (() => capitalise("titleCase")) },
        ],
      },
    ],
  };
}

/** Format > Paragraph styles. */
export function paragraphStylesMenu(editor: Editor, actions: EditorActions, current: ParagraphStyle | null): MenuItem {
  return {
    label: "Paragraph styles",
    icon: "format_paragraph",
    submenu: [
      ...paragraphStyles.map((style) => styleEntry(editor, style, current, false)),
      "separator",
      { label: "Options", onSelect: actions.styleOptions },
    ],
  };
}

/** Format > Align and indent. */
export function alignAndIndentMenu(editor: Editor, actions: EditorActions): MenuItem {
  const run = () => editor.chain().focus();
  return {
    label: "Align and indent",
    icon: "format_align_left",
    submenu: [
      { label: "Left", shortcut: shortcut("⌘+Shift+L"), onSelect: () => run().setTextAlign("left").run() },
      { label: "Centre", shortcut: shortcut("⌘+Shift+E"), onSelect: () => run().setTextAlign("center").run() },
      { label: "Right", shortcut: shortcut("⌘+Shift+R"), onSelect: () => run().setTextAlign("right").run() },
      { label: "Justified", shortcut: shortcut("⌘+Shift+J"), onSelect: () => run().setTextAlign("justify").run() },
      "separator",
      { label: "Increase indent", shortcut: shortcut("⌘+]"), onSelect: () => run().changeIndent(1).run() },
      { label: "Decrease indent", shortcut: shortcut("⌘+["), onSelect: () => run().changeIndent(-1).run() },
      { label: "Indentation options", onSelect: actions.indentationOptions },
    ],
  };
}
