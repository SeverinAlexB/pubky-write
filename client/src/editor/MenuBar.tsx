import type { Editor } from "@tiptap/react";
import {
  Download,
  FilePlus,
  FileText,
  Hash,
  History,
  ImagePlus,
  Link2,
  Minus,
  PanelLeft,
  Pencil,
  Printer,
  Redo2,
  Search,
  Table2,
  Trash2,
  Undo2,
} from "lucide-react";
import { lineSpacings } from "@docs/shared";
import { Menu } from "../components/Menu.tsx";
import { changeFontSize } from "./extensions.ts";
import { applyParagraphStyle, lineSpacingLabel, modKey, paragraphStyles } from "./Toolbar.tsx";

export type MenuActions = {
  newDocument: () => void;
  rename: () => void;
  download: (format: "docx" | "md" | "pdf") => void;
  openHistory: () => void;
  print: () => void;
  deleteDocument: () => void;
  insertLink: () => void;
  insertImage: () => void;
  find: (withReplace: boolean) => void;
  wordCount: () => void;
  toggleOutline: () => void;
};

/** The File / Edit / Insert / Format menus under the document title. */
export function MenuBar({ editor, actions, outlineOpen }: { editor: Editor; actions: MenuActions; outlineOpen: boolean }) {
  const run = () => editor.chain().focus();

  return (
    <nav className="menubar" aria-label="Menu bar">
      <Menu
        label="File"
        entries={[
          { label: "New document", icon: <FilePlus size={16} />, onSelect: actions.newDocument },
          { label: "Rename", icon: <Pencil size={16} />, onSelect: actions.rename },
          "separator",
          { label: "Download as Word (.docx)", icon: <Download size={16} />, onSelect: () => actions.download("docx") },
          { label: "Download as Markdown (.md)", icon: <Download size={16} />, onSelect: () => actions.download("md") },
          { label: "Download as PDF (.pdf)", icon: <FileText size={16} />, onSelect: () => actions.download("pdf") },
          "separator",
          { label: "Version history", icon: <History size={16} />, shortcut: `${modKey}Alt+Shift+H`, onSelect: actions.openHistory },
          { label: "Print", icon: <Printer size={16} />, shortcut: `${modKey}P`, onSelect: actions.print },
          "separator",
          { label: "Move to bin", icon: <Trash2 size={16} />, onSelect: actions.deleteDocument },
        ]}
      />
      <Menu
        label="Edit"
        entries={[
          { label: "Undo", icon: <Undo2 size={16} />, shortcut: `${modKey}Z`, onSelect: () => run().undo().run() },
          { label: "Redo", icon: <Redo2 size={16} />, shortcut: `${modKey}Shift+Z`, onSelect: () => run().redo().run() },
          "separator",
          { label: "Select all", shortcut: `${modKey}A`, onSelect: () => run().selectAll().run() },
          "separator",
          { label: "Find", icon: <Search size={16} />, shortcut: `${modKey}F`, onSelect: () => actions.find(false) },
          { label: "Find and replace", shortcut: `${modKey}Shift+H`, onSelect: () => actions.find(true) },
        ]}
      />
      <Menu
        label="View"
        entries={[
          { label: "Show outline", icon: <PanelLeft size={16} />, checked: outlineOpen, onSelect: actions.toggleOutline },
        ]}
      />
      <Menu
        label="Insert"
        entries={[
          { label: "Image", icon: <ImagePlus size={16} />, onSelect: actions.insertImage },
          {
            label: "Table",
            icon: <Table2 size={16} />,
            onSelect: () => run().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
          },
          { label: "Link", icon: <Link2 size={16} />, shortcut: `${modKey}K`, onSelect: actions.insertLink },
          { label: "Horizontal line", icon: <Minus size={16} />, onSelect: () => run().setHorizontalRule().run() },
        ]}
      />
      <Menu
        label="Format"
        entries={[
          { label: "Bold", shortcut: `${modKey}B`, onSelect: () => run().toggleBold().run() },
          { label: "Italic", shortcut: `${modKey}I`, onSelect: () => run().toggleItalic().run() },
          { label: "Underline", shortcut: `${modKey}U`, onSelect: () => run().toggleUnderline().run() },
          { label: "Strikethrough", shortcut: `${modKey}Shift+S`, onSelect: () => run().toggleStrike().run() },
          "separator",
          ...paragraphStyles.map(({ value, label }) => ({
            label,
            shortcut: value === "paragraph" ? `${modKey}Alt+0` : `${modKey}Alt+${value.slice(1)}`,
            onSelect: () => applyParagraphStyle(editor, value),
          })),
          "separator",
          { label: "Bulleted list", shortcut: `${modKey}Shift+8`, onSelect: () => run().toggleBulletList().run() },
          { label: "Numbered list", shortcut: `${modKey}Shift+7`, onSelect: () => run().toggleOrderedList().run() },
          { label: "Quote", shortcut: `${modKey}Shift+B`, onSelect: () => run().toggleBlockquote().run() },
          { label: "Code block", shortcut: `${modKey}Alt+C`, onSelect: () => run().toggleCodeBlock().run() },
          "separator",
          ...lineSpacings.map((spacing) => ({
            label: `Line spacing: ${lineSpacingLabel(spacing)}`,
            onSelect: () => run().setLineSpacing(spacing).run(),
          })),
          { label: "Increase indent", shortcut: "Tab", onSelect: () => run().changeIndent(1).run() },
          { label: "Decrease indent", shortcut: "Shift+Tab", onSelect: () => run().changeIndent(-1).run() },
          "separator",
          { label: "Increase font size", shortcut: `${modKey}Shift+.`, onSelect: () => changeFontSize(editor, 1) },
          { label: "Decrease font size", shortcut: `${modKey}Shift+,`, onSelect: () => changeFontSize(editor, -1) },
          "separator",
          {
            label: "Clear formatting",
            shortcut: `${modKey}\\`,
            onSelect: () => run().unsetAllMarks().setTextAlign("left").run(),
          },
        ]}
      />
      <Menu
        label="Tools"
        entries={[{ label: "Word count", icon: <Hash size={16} />, shortcut: `${modKey}Shift+C`, onSelect: actions.wordCount }]}
      />
    </nav>
  );
}
