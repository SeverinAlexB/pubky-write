import { lineSpacings } from "@docs/shared";
import type { Editor } from "@tiptap/react";
import type { MenuEntry } from "../components/MenuList.tsx";
import type { EditorActions } from "./actions.ts";

export function lineSpacingLabel(spacing: number): string {
  if (spacing === 1) return "Single";
  if (spacing === 2) return "Double";
  return String(spacing);
}

/** Format > Line & paragraph spacing, also opened from the toolbar. */
export function lineSpacingEntries(editor: Editor, actions: EditorActions, current: number | null): MenuEntry[] {
  return [
    ...lineSpacings.map((spacing) => ({
      label: lineSpacingLabel(spacing),
      checked: current === spacing,
      onSelect: () => editor.chain().focus().setLineSpacing(spacing).run(),
    })),
    "separator",
    { label: "Add space before paragraph", onSelect: actions.toggleSpaceBefore },
    { label: "Add space after paragraph", onSelect: actions.toggleSpaceAfter },
    "separator",
    { label: "Custom spacing…", onSelect: actions.customSpacing },
    "separator",
    { label: "Keep with next", checked: false, onSelect: actions.toggleKeepWithNext },
    { label: "Keep lines together", checked: false, onSelect: actions.toggleKeepLinesTogether },
    { label: "Prevent single lines", checked: false, onSelect: actions.togglePreventSingleLines },
    { label: "Add page break before", checked: false, onSelect: actions.togglePageBreakBefore },
  ];
}
