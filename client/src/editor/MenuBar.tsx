import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { useCallback, useRef, useState } from "react";
import { MenuList, type MenuEntry, type MenuItem } from "../components/MenuList.tsx";
import { shortcut } from "../components/shortcuts.ts";
import { useDismiss } from "../components/useDismiss.ts";
import type { EditorActions, ListKind, ViewSettings } from "./actions.ts";
import { changeFontSize, clearFormatting } from "./extensions.ts";
import { lineSpacingEntries, paragraphSpacingAt } from "./formatMenus.ts";
import { ListPresetGrid } from "./ListPresets.tsx";
import { currentParagraphStyle, paragraphStyles } from "./paragraphStyles.ts";
import { TableSizePicker } from "./TableSizePicker.tsx";
import { styleEntry } from "./toolbar/TextControls.tsx";

type MenuBarProps = { editor: Editor; actions: EditorActions; view: ViewSettings };

type MenuState = ReturnType<typeof selectMenuState>;

function selectMenuState({ editor }: { editor: Editor }) {
  return {
    canUndo: editor.can().undo(),
    canRedo: editor.can().redo(),
    hasSelection: !editor.state.selection.empty,
    inTable: editor.isActive("table"),
    style: currentParagraphStyle(editor),
    spacing: paragraphSpacingAt(editor),
  };
}

/**
 * File, Edit, View, Insert, Format and Tools. Once a menu is open, hovering another
 * label switches to it, and ← → move between menus.
 */
export function MenuBar({ editor, actions, view }: MenuBarProps) {
  const state = useEditorState({ editor, selector: selectMenuState });
  const [open, setOpen] = useState<{ index: number; fromKeyboard: boolean } | null>(null);
  const root = useRef<HTMLElement>(null);
  const close = useCallback(() => setOpen(null), []);
  useDismiss(root, open !== null, close);

  const menus: { label: string; entries: MenuEntry[] }[] = [
    { label: "File", entries: fileMenu(actions) },
    { label: "Edit", entries: editMenu(editor, actions, state) },
    { label: "View", entries: viewMenu(actions, view) },
    { label: "Insert", entries: insertMenu(editor, actions, state) },
    { label: "Format", entries: formatMenu(editor, actions, state) },
    { label: "Tools", entries: toolsMenu(actions) },
  ];
  const step = (direction: 1 | -1) =>
    setOpen((current) => current && { index: (current.index + direction + menus.length) % menus.length, fromKeyboard: true });

  return (
    <nav className="menubar" aria-label="Menu bar" ref={root}>
      {menus.map((menu, index) => (
        <div key={menu.label} className="menu">
          <button
            type="button"
            className="menu-button"
            aria-haspopup="menu"
            aria-expanded={open?.index === index}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) =>
              setOpen((current) => (current?.index === index ? null : { index, fromKeyboard: event.detail === 0 }))
            }
            onMouseEnter={() => setOpen((current) => current && { index, fromKeyboard: false })}
          >
            {menu.label}
          </button>
          {open?.index === index && (
            <MenuList
              // Remount when switching menus, so highlight and submenus start fresh.
              key={index}
              entries={menu.entries}
              label={menu.label}
              highlightFirst={open.fromKeyboard}
              className="menu-list-start menubar-menu"
              onClose={close}
              onLeft={() => step(-1)}
              onRight={() => step(1)}
            />
          )}
        </div>
      ))}
    </nav>
  );
}

function fileMenu(actions: EditorActions): MenuEntry[] {
  return [
    { label: "New", icon: "description", submenu: [{ label: "Document", icon: "description", onSelect: actions.newDocument }] },
    { label: "Open", icon: "folder_open", shortcut: shortcut("⌘O"), onSelect: actions.openDocumentList },
    { label: "Make a copy", icon: "file_copy", onSelect: actions.makeCopy },
    "separator",
    {
      label: "Download",
      icon: "download",
      submenu: [
        { label: "Microsoft Word (.docx)", onSelect: () => actions.download("docx") },
        { label: "PDF document (.pdf)", onSelect: () => actions.download("pdf") },
        { label: "Plain text (.txt)", onSelect: () => actions.download("txt") },
        { label: "Markdown (.md)", onSelect: () => actions.download("md") },
      ],
    },
    "separator",
    { label: "Rename", icon: "edit", onSelect: actions.rename },
    { label: "Move to bin", icon: "delete", onSelect: actions.moveToBin },
    "separator",
    {
      label: "Version history",
      icon: "history",
      submenu: [
        { label: "Name current version", onSelect: actions.nameCurrentVersion },
        { label: "See version history", shortcut: shortcut("⌘+Option+Shift+H"), onSelect: actions.openVersionHistory },
      ],
    },
    "separator",
    { label: "Details", icon: "info", onSelect: actions.showDetails },
    { label: "Page setup", icon: "article", onSelect: actions.pageSetup },
    { label: "Print", icon: "print", shortcut: shortcut("⌘P"), onSelect: actions.print },
  ];
}

function editMenu(editor: Editor, actions: EditorActions, state: MenuState): MenuEntry[] {
  const run = () => editor.chain().focus();
  const noSelection = !state.hasSelection;
  return [
    { label: "Undo", icon: "undo", shortcut: shortcut("⌘Z"), disabled: !state.canUndo, onSelect: () => run().undo().run() },
    { label: "Redo", icon: "redo", shortcut: shortcut("⌘Y"), disabled: !state.canRedo, onSelect: () => run().redo().run() },
    "separator",
    { label: "Cut", icon: "content_cut", shortcut: shortcut("⌘X"), disabled: noSelection, onSelect: actions.cut },
    { label: "Copy", icon: "content_copy", shortcut: shortcut("⌘C"), disabled: noSelection, onSelect: actions.copy },
    { label: "Copy as Markdown", icon: "markdown", disabled: noSelection, onSelect: actions.copyAsMarkdown },
    { label: "Paste", icon: "content_paste", shortcut: shortcut("⌘V"), onSelect: actions.paste },
    { label: "Paste without formatting", shortcut: shortcut("⌘+Shift+V"), onSelect: actions.pasteWithoutFormatting },
    { label: "Paste from Markdown", onSelect: actions.pasteFromMarkdown },
    "separator",
    { label: "Select all", icon: "select_all", shortcut: shortcut("⌘A"), onSelect: () => run().selectAll().run() },
    { label: "Delete", icon: "delete", disabled: noSelection, onSelect: () => run().deleteSelection().run() },
    "separator",
    { label: "Find and replace", icon: "find_replace", shortcut: shortcut("⌘+Shift+H"), onSelect: actions.findAndReplace },
  ];
}

function viewMenu(actions: EditorActions, view: ViewSettings): MenuEntry[] {
  return [
    {
      label: "Mode",
      icon: "edit",
      submenu: [
        { label: "Editing", checked: true, onSelect: actions.setViewingMode && (() => actions.setViewingMode!(false)) },
        { label: "Viewing", checked: false, onSelect: actions.setViewingMode && (() => actions.setViewingMode!(true)) },
      ],
    },
    {
      label: "Comments",
      icon: "comment",
      submenu: [
        {
          label: "Hide comments",
          shortcut: shortcut("⌘+Option+Shift+J"),
          checked: view.commentsHidden,
          onSelect: actions.hideComments,
        },
        { label: "Show all comments", shortcut: shortcut("⌘+Option+Shift+A"), onSelect: actions.showAllComments },
      ],
    },
    {
      label: view.outlineOpen ? "Collapse tabs and outlines sidebar" : "Expand tabs and outlines sidebar",
      icon: "toc",
      onSelect: actions.toggleOutline,
    },
    "separator",
    { label: "Show print layout", checked: view.printLayout, onSelect: actions.togglePrintLayout },
    { label: "Show ruler", checked: view.rulerVisible, onSelect: actions.toggleRuler },
    {
      label: "Show non-printing characters",
      shortcut: shortcut("⌘+Shift+P"),
      checked: view.nonPrintingCharacters,
      onSelect: actions.toggleNonPrintingCharacters,
    },
    "separator",
    { label: "Full screen", icon: "fullscreen", onSelect: actions.fullScreen },
  ];
}

function insertMenu(editor: Editor, actions: EditorActions, state: MenuState): MenuEntry[] {
  return [
    {
      label: "Image",
      icon: "image",
      submenu: [
        { label: "Upload from computer", icon: "upload", onSelect: actions.uploadImage },
        { label: "By URL", icon: "link", onSelect: actions.insertImageByUrl },
      ],
    },
    {
      label: "Table",
      icon: "table",
      disabled: state.inTable,
      panel: (close) => (
        <TableSizePicker
          onPick={(columns, rows) => {
            close();
            editor.chain().focus().insertTable({ rows, cols: columns, withHeaderRow: false }).run();
          }}
        />
      ),
    },
    { label: "Link", icon: "link", shortcut: shortcut("⌘K"), onSelect: actions.insertLink },
    {
      label: "Symbols",
      icon: "special_character",
      submenu: [
        { label: "Special characters", onSelect: actions.insertSpecialCharacter },
        { label: "Emoji", onSelect: actions.insertEmoji },
      ],
    },
    "separator",
    { label: "Horizontal line", icon: "horizontal_rule", onSelect: () => editor.chain().focus().setHorizontalRule().run() },
    {
      label: "Break",
      icon: "insert_page_break",
      submenu: [{ label: "Page break", shortcut: shortcut("⌘+Enter"), onSelect: actions.insertPageBreak }],
    },
    {
      label: "Page elements",
      icon: "page_header",
      submenu: [
        { label: "Table of contents", onSelect: actions.insertTableOfContents },
        { label: "Header", onSelect: actions.insertHeader },
        { label: "Footer", onSelect: actions.insertFooter },
        { label: "Page numbers", onSelect: actions.insertPageNumbers },
        { label: "Footnote", shortcut: shortcut("⌘+Option+F"), onSelect: actions.insertFootnote },
      ],
    },
    "separator",
    {
      label: "Comment",
      icon: "add_comment",
      shortcut: shortcut("⌘+Option+M"),
      disabled: !state.hasSelection,
      onSelect: actions.addComment,
    },
  ];
}

function formatMenu(editor: Editor, actions: EditorActions, state: MenuState): MenuEntry[] {
  const run = () => editor.chain().focus();
  const capitalise = actions.setCapitalisation;
  return [
    {
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
    },
    {
      label: "Paragraph styles",
      icon: "format_paragraph",
      submenu: paragraphStyles.flatMap((style, index): MenuEntry[] => [
        ...(index > 0 ? ["separator" as const] : []),
        styleEntry(editor, style, state.style),
      ]),
    },
    {
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
    },
    {
      label: "Line & paragraph spacing",
      icon: "format_line_spacing",
      submenu: lineSpacingEntries(editor, actions, state.spacing),
    },
    {
      label: "Bullets and numbering",
      icon: "format_list_bulleted",
      submenu: [
        listPresetEntry("Numbered list menu", "numbered", actions),
        listPresetEntry("Bulleted list menu", "bullet", actions),
        listPresetEntry("Checklist menu", "checklist", actions),
      ],
    },
    "separator",
    { label: "Page orientation", onSelect: actions.setPageOrientation },
    { label: "Switch to pageless format", onSelect: actions.switchToPageless },
    "separator",
    {
      label: "Table",
      icon: "table",
      disabled: !state.inTable,
      submenu: [
        { label: "Insert row above", onSelect: () => run().addRowBefore().run() },
        { label: "Insert row below", onSelect: () => run().addRowAfter().run() },
        { label: "Insert column left", onSelect: () => run().addColumnBefore().run() },
        { label: "Insert column right", onSelect: () => run().addColumnAfter().run() },
        "separator",
        { label: "Delete row", onSelect: () => run().deleteRow().run() },
        { label: "Delete column", onSelect: () => run().deleteColumn().run() },
        { label: "Delete table", onSelect: () => run().deleteTable().run() },
      ],
    },
    "separator",
    { label: "Clear formatting", icon: "format_clear", shortcut: shortcut("⌘\\"), onSelect: () => clearFormatting(editor) },
  ];
}

function listPresetEntry(label: string, kind: ListKind, actions: EditorActions): MenuItem {
  const apply = actions.applyListPreset;
  return {
    label,
    disabled: !apply,
    panel: (close) => (
      <ListPresetGrid
        kind={kind}
        onPick={(preset) => {
          close();
          apply?.(kind, preset);
        }}
      />
    ),
  };
}

function toolsMenu(actions: EditorActions): MenuEntry[] {
  return [
    { label: "Word count", icon: "tag", shortcut: shortcut("⌘+Shift+C"), onSelect: actions.wordCount },
    { label: "Preferences", icon: "tune", onSelect: actions.preferences },
  ];
}
