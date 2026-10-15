import { columnsOf, listPresetAt } from "@docs/shared";
import type { Editor } from "@tiptap/react";
import { useCallback, useRef, useState, type KeyboardEvent } from "react";
import { MenuList, type MenuEntry, type MenuItem } from "../components/MenuList.tsx";
import { modeEntries } from "./modes.tsx";
import { shortcutText } from "../shortcuts.ts";
import { useDismiss } from "../components/useDismiss.ts";
import type { DownloadFormat, EditorActions, ListKind, ViewSettings } from "./actions.ts";
import { clearFormatting } from "./extensions.ts";
import { alignAndIndentMenu, lineSpacingEntries, paragraphSpacingAt, paragraphStylesMenu, textMenu } from "./formatMenus.ts";
import { ColumnPresetsPanel } from "./ColumnOptions.tsx";
import { ListPresetMenu } from "./ListPresets.tsx";
import { PageNumbersPanel, TableOfContentsPanel } from "./PageElementPresets.tsx";
import { currentParagraphStyle } from "./paragraphStyles.ts";
import { useSwitchingEditorState } from "./switchingEditorState.ts";
import { formatTableMenu, tableMenuState } from "./tableMenus.ts";
import { TableSizePicker } from "./TableSizePicker.tsx";

type MenuBarProps = { editor: Editor; actions: EditorActions; view: ViewSettings };

type MenuState = ReturnType<typeof selectMenuState>;

function selectMenuState(editor: Editor) {
  return {
    canUndo: editor.can().undo(),
    canRedo: editor.can().redo(),
    hasSelection: !editor.state.selection.empty,
    inTable: editor.isActive("table"),
    columns: columnsOf(editor.state.doc).columns,
    table: tableMenuState(editor),
    style: currentParagraphStyle(editor),
    spacing: paragraphSpacingAt(editor),
    listPresets: {
      bullet: listPresetAt(editor.state, "bullet"),
      numbered: listPresetAt(editor.state, "numbered"),
      checklist: listPresetAt(editor.state, "checklist"),
    },
  };
}

/**
 * File, Edit, View, Insert, Format and Tools, following the WAI-ARIA menubar pattern. The bar is
 * one Tab stop: ← → (and Home, End) move between the menus, ↓ Enter or Space open one, and
 * Escape returns to the document. Once a menu is open, hovering another label switches to it,
 * and ← → move between menus.
 */
export function MenuBar({ editor, actions, view }: MenuBarProps) {
  const state = useSwitchingEditorState(editor, selectMenuState);
  const [open, setOpen] = useState<{ index: number; fromKeyboard: boolean } | null>(null);
  // The menu that is in the Tab order: the last one focused.
  const [focusIndex, setFocusIndex] = useState(0);
  const root = useRef<HTMLElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const close = useCallback(() => setOpen(null), []);
  useDismiss(root, open !== null, close);

  // Viewing mode (and the suggestion previews) disable everything that would change the document.
  const editing = (entries: MenuEntry[], keep: string[] = []) => (view.readOnly ? readOnlyEntries(entries, keep) : entries);
  const menus: { label: string; entries: MenuEntry[] }[] = [
    { label: "File", entries: fileMenu(actions, view) },
    { label: "Edit", entries: editing(editMenu(editor, actions, state), ["Copy", "Copy as Markdown", "Select all", "Find and replace"]) },
    { label: "View", entries: viewMenu(actions, view) },
    { label: "Insert", entries: editing(insertMenu(editor, actions, state)) },
    { label: "Format", entries: editing(formatMenu(editor, actions, state)) },
    { label: "Tools", entries: toolsMenu(actions) },
  ];
  const wrap = (index: number) => (index + menus.length) % menus.length;
  /** Moves keyboard focus to a menu's label, if focus is in the menu bar (not in the document). */
  const focusMenu = (index: number) => {
    if (!root.current?.contains(document.activeElement)) return;
    setFocusIndex(index);
    buttons.current[index]?.focus();
  };
  const step = (direction: 1 | -1) => {
    if (!open) return;
    const index = wrap(open.index + direction);
    setOpen({ index, fromKeyboard: true });
    focusMenu(index);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    // An open menu handles the keys itself.
    if (open || event.altKey || event.metaKey || event.ctrlKey) return;
    const target = { ArrowRight: wrap(index + 1), ArrowLeft: wrap(index - 1), Home: 0, End: menus.length - 1 }[event.key];
    if (target !== undefined) {
      event.preventDefault();
      focusMenu(target);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen({ index, fromKeyboard: true });
    } else if (event.key === "Escape") {
      event.preventDefault();
      editor.commands.focus();
    }
  };

  return (
    <nav className="menubar" role="menubar" aria-label="Menu bar" ref={root}>
      {menus.map((menu, index) => (
        <div key={menu.label} className="menu" role="none">
          <button
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="menuitem"
            className="menu-button"
            tabIndex={index === focusIndex ? 0 : -1}
            aria-haspopup="menu"
            aria-expanded={open?.index === index}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) =>
              setOpen((current) => (current?.index === index ? null : { index, fromKeyboard: event.detail === 0 }))
            }
            onMouseEnter={() => setOpen((current) => current && { index, fromKeyboard: false })}
            onFocus={() => setFocusIndex(index)}
            onKeyDown={(event) => onKeyDown(event, index)}
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

const downloadFormats: { label: string; format: DownloadFormat }[] = [
  { label: "Microsoft Word (.docx)", format: "docx" },
  { label: "PDF document (.pdf)", format: "pdf" },
  { label: "Plain text (.txt)", format: "txt" },
  { label: "Markdown (.md)", format: "md" },
];

/** The formats, and with several tabs a "Current tab" and an "All tabs" group (printing is of the current tab). */
function downloadMenu(actions: EditorActions, view: ViewSettings): MenuEntry[] {
  const items = (scope: "current" | "all") =>
    downloadFormats
      .filter(({ format }) => scope === "current" || format !== "pdf")
      .map(({ label, format }) => ({
        label: scope === "all" ? `${label}, all tabs` : label,
        content: label,
        onSelect: () => actions.download(format, scope),
      }));
  if (!view.multipleTabs) return items("current");
  return [{ heading: "Current tab" }, ...items("current"), "separator", { heading: "All tabs" }, ...items("all")];
}

function fileMenu(actions: EditorActions, view: ViewSettings): MenuEntry[] {
  return [
    { label: "New", icon: "description", submenu: [{ label: "Document", icon: "description", onSelect: actions.newDocument }] },
    { label: "Open", icon: "folder_open", shortcut: shortcutText("open"), onSelect: actions.openDocumentList },
    { label: "Make a copy", icon: "file_copy", onSelect: actions.makeCopy },
    "separator",
    {
      label: "Download",
      icon: "download",
      submenu: downloadMenu(actions, view),
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
        { label: "See version history", shortcut: shortcutText("versionHistory"), onSelect: actions.openVersionHistory },
      ],
    },
    "separator",
    { label: "Details", icon: "info", onSelect: actions.showDetails },
    { label: "Page setup", icon: "article", onSelect: actions.pageSetup },
    { label: "Print", icon: "print", shortcut: shortcutText("print"), onSelect: actions.print },
  ];
}

function editMenu(editor: Editor, actions: EditorActions, state: MenuState): MenuEntry[] {
  const run = () => editor.chain().focus();
  const noSelection = !state.hasSelection;
  return [
    { label: "Undo", icon: "undo", shortcut: shortcutText("undo"), disabled: !state.canUndo, onSelect: () => run().undo().run() },
    { label: "Redo", icon: "redo", shortcut: shortcutText("redo"), disabled: !state.canRedo, onSelect: () => run().redo().run() },
    "separator",
    { label: "Cut", icon: "content_cut", shortcut: shortcutText("cut"), disabled: noSelection, onSelect: actions.cut },
    { label: "Copy", icon: "content_copy", shortcut: shortcutText("copy"), disabled: noSelection, onSelect: actions.copy },
    { label: "Copy as Markdown", icon: "markdown", disabled: noSelection, onSelect: actions.copyAsMarkdown },
    { label: "Paste", icon: "content_paste", shortcut: shortcutText("paste"), onSelect: actions.paste },
    { label: "Paste without formatting", shortcut: shortcutText("pasteWithoutFormatting"), onSelect: actions.pasteWithoutFormatting },
    { label: "Paste from Markdown", onSelect: actions.pasteFromMarkdown },
    "separator",
    { label: "Select all", icon: "select_all", shortcut: shortcutText("selectAll"), onSelect: () => run().selectAll().run() },
    { label: "Delete", icon: "delete", disabled: noSelection, onSelect: () => run().deleteSelection().run() },
    "separator",
    { label: "Find and replace", icon: "find_replace", shortcut: shortcutText("findAndReplace"), onSelect: actions.findAndReplace },
  ];
}

function viewMenu(actions: EditorActions, view: ViewSettings): MenuEntry[] {
  return [
    {
      label: "Mode",
      icon: "edit",
      submenu: actions.setMode ? modeEntries(view.mode, actions.setMode) : [],
    },
    {
      label: "Comments",
      icon: "comment",
      submenu: [
        {
          label: "Hide comments",
          shortcut: shortcutText("hideComments"),
          checked: view.commentsHidden,
          onSelect: actions.hideComments,
        },
        { label: "Show all comments", shortcut: shortcutText("showAllComments"), onSelect: actions.showAllComments },
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
      shortcut: shortcutText("nonPrintingCharacters"),
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
    { label: "Link", icon: "link", shortcut: shortcutText("insertLink"), onSelect: actions.insertLink },
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
      submenu: [
        { label: "Page break", shortcut: shortcutText("pageBreak"), onSelect: actions.insertPageBreak },
        // A column break only does something with more than one column.
        { label: "Column break", disabled: state.columns < 2, onSelect: actions.insertColumnBreak },
      ],
    },
    {
      label: "Page elements",
      icon: "page_header",
      submenu: [
        {
          label: "Table of contents",
          icon: "toc",
          disabled: !actions.insertTableOfContents,
          panel: (close) => (
            <TableOfContentsPanel
              onPick={(style) => {
                close();
                actions.insertTableOfContents?.(style);
              }}
            />
          ),
        },
        { label: "Header", icon: "page_header", shortcut: shortcutText("header"), onSelect: actions.insertHeader },
        { label: "Footer", icon: "page_footer", shortcut: shortcutText("footer"), onSelect: actions.insertFooter },
        {
          label: "Page numbers",
          icon: "tag",
          disabled: !actions.insertPageNumbers,
          panel: (close) => (
            <PageNumbersPanel
              onPreset={(options) => {
                close();
                actions.insertPageNumbers?.(options);
              }}
              onMoreOptions={() => {
                close();
                actions.pageNumberOptions?.();
              }}
              onPageCount={() => {
                close();
                actions.insertPageCount?.();
              }}
            />
          ),
        },
        { label: "Footnote", icon: "superscript", shortcut: shortcutText("footnote"), onSelect: actions.insertFootnote },
      ],
    },
    "separator",
    {
      label: "Comment",
      icon: "add_comment",
      shortcut: shortcutText("addComment"),
      disabled: !state.hasSelection,
      onSelect: actions.addComment,
    },
  ];
}

function readOnlyEntries(entries: MenuEntry[], keep: string[]): MenuEntry[] {
  return entries.map((entry) =>
    entry === "separator" || "heading" in entry || keep.includes(entry.label) ? entry : { ...entry, disabled: true },
  );
}


function formatMenu(editor: Editor, actions: EditorActions, state: MenuState): MenuEntry[] {
  return [
    textMenu(editor, actions),
    paragraphStylesMenu(editor, actions, state.style),
    alignAndIndentMenu(editor, actions),
    {
      label: "Line & paragraph spacing",
      icon: "format_line_spacing",
      submenu: lineSpacingEntries(editor, actions, state.spacing),
    },
    {
      label: "Columns",
      icon: "view_column",
      disabled: !actions.setColumns,
      panel: (close) => (
        <ColumnPresetsPanel
          current={state.columns}
          onPick={(columns) => {
            close();
            actions.setColumns?.(columns);
          }}
          onMoreOptions={() => {
            close();
            actions.columnOptions?.();
          }}
        />
      ),
    },
    {
      label: "Bullets and numbering",
      icon: "format_list_bulleted",
      submenu: [
        listPresetEntry("Numbered list menu", "numbered", actions, state),
        listPresetEntry("Bulleted list menu", "bullet", actions, state),
        listPresetEntry("Checklist menu", "checklist", actions, state),
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
      submenu: formatTableMenu(editor, actions, state.table),
    },
    "separator",
    { label: "Clear formatting", icon: "format_clear", shortcut: shortcutText("clearFormatting"), onSelect: () => clearFormatting(editor) },
  ];
}

function listPresetEntry(label: string, kind: ListKind, actions: EditorActions, state: MenuState): MenuItem {
  const apply = actions.applyListPreset;
  return {
    label,
    disabled: !apply,
    panel: (close) => (
      <ListPresetMenu
        kind={kind}
        current={state.listPresets}
        onPick={(pickedKind, preset) => {
          close();
          apply?.(pickedKind, preset);
        }}
      />
    ),
  };
}

function toolsMenu(actions: EditorActions): MenuEntry[] {
  return [
    { label: "Word count", icon: "tag", shortcut: shortcutText("wordCount"), onSelect: actions.wordCount },
    { label: "Review suggested edits", icon: "rate_review", shortcut: shortcutText("reviewSuggestions"), onSelect: actions.reviewSuggestedEdits },
    { label: "Preferences", icon: "tune", onSelect: actions.preferences },
    { label: "Keyboard shortcuts", icon: "keyboard", shortcut: shortcutText("keyboardShortcuts"), onSelect: actions.keyboardShortcuts },
  ];
}
