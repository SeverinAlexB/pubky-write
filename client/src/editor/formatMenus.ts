import { DEFAULT_LINE_SPACING, lineSpacings, paragraphSpace } from "@docs/shared";
import type { Editor } from "@tiptap/react";
import type { MenuEntry } from "../components/MenuList.tsx";
import type { EditorActions } from "./actions.ts";

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
