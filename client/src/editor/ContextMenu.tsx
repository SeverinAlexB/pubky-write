// The right-click menu of the document. Shift+right-click shows the browser's menu instead, so
// its spell-check suggestions stay reachable.
import { commentQuote } from "@docs/shared";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
import type { Editor } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MenuList, type MenuEntry } from "../components/MenuList.tsx";
import { shortcutText } from "../shortcuts.ts";
import { useDismiss } from "../components/useDismiss.ts";
import type { EditorActions } from "./actions.ts";
import { clearFormatting } from "./extensions.ts";
import { alignAndIndentMenu, lineSpacingEntries, paragraphSpacingAt, paragraphStylesMenu, textMenu } from "./formatMenus.ts";
import { currentParagraphStyle } from "./paragraphStyles.ts";
import { contextTableMenu } from "./tableMenus.ts";

type ContextMenuProps = {
  editor: Editor;
  actions: EditorActions;
  /** Copy link: the caller reports the result. */
  onCopyLink: (href: string) => void;
};

export function ContextMenu({ editor, actions, onCopyLink }: ContextMenuProps) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setAt(null), []);
  useDismiss(root, at !== null, close);

  useEffect(() => {
    const dom = editor.view.dom;
    const onContextMenu = (event: MouseEvent) => {
      if (event.shiftKey || !editor.isEditable) return;
      event.preventDefault();
      placeCursor(editor, event);
      setAt({ x: event.clientX, y: event.clientY });
    };
    dom.addEventListener("contextmenu", onContextMenu);
    // The menu belongs to a place in the document: it closes when the page is scrolled or resized.
    const onWheel = (event: WheelEvent) => {
      if (!(event.target instanceof Element && event.target.closest(".context-menu"))) close();
    };
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    window.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      dom.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("wheel", onWheel);
    };
  }, [editor, close]);

  if (!at) return null;
  return (
    <div ref={root} className="context-menu">
      <MenuList
        entries={contextMenuEntries(editor, actions, onCopyLink)}
        label="Context menu"
        className="context-menu-list"
        at={at}
        onClose={close}
      />
    </div>
  );
}

/**
 * A right-click inside a non-empty selection keeps it; anywhere else it puts the cursor at the
 * pointer first (or selects the image under it).
 */
function placeCursor(editor: Editor, event: MouseEvent) {
  const { view } = editor;
  const { selection, doc } = view.state;
  const target = event.target instanceof Element ? event.target : null;
  view.focus();
  const image = target?.closest(".image-frame");
  if (image) {
    const imagePos = view.posAtDOM(image, 0);
    if (doc.nodeAt(imagePos)?.type.name === "image") view.dispatch(view.state.tr.setSelection(NodeSelection.create(doc, imagePos)));
    return;
  }
  if (selection instanceof CellSelection && target?.closest(".selectedCell")) return;
  const position = view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (!position) return;
  const inside = !selection.empty && !(selection instanceof NodeSelection) && position.pos >= selection.from && position.pos <= selection.to;
  if (!inside) view.dispatch(view.state.tr.setSelection(TextSelection.near(doc.resolve(position.pos))));
}

export function contextMenuEntries(editor: Editor, actions: EditorActions, onCopyLink: (href: string) => void): MenuEntry[] {
  const run = () => editor.chain().focus();
  const { selection } = editor.state;
  const noSelection = selection.empty;
  const inTable = editor.isActive("table");
  const href = editor.getAttributes("link").href as string | undefined;
  const onLink = editor.isActive("link") && Boolean(href);
  const commentable = !noSelection && commentQuote(editor.state.doc, selection.from, selection.to) !== "";

  return [
    { label: "Cut", icon: "content_cut", shortcut: shortcutText("cut"), disabled: noSelection, onSelect: actions.cut },
    { label: "Copy", icon: "content_copy", shortcut: shortcutText("copy"), disabled: noSelection, onSelect: actions.copy },
    { label: "Copy as Markdown", icon: "markdown", disabled: noSelection, onSelect: actions.copyAsMarkdown },
    { label: "Paste", icon: "content_paste", shortcut: shortcutText("paste"), onSelect: actions.paste },
    { label: "Paste without formatting", shortcut: shortcutText("pasteWithoutFormatting"), onSelect: actions.pasteWithoutFormatting },
    { label: "Paste from Markdown", onSelect: actions.pasteFromMarkdown },
    { label: "Delete", icon: "delete", disabled: noSelection, onSelect: () => run().deleteSelection().run() },
    "separator",
    ...(inTable ? [...contextTableMenu(editor, actions), "separator" as const] : []),
    {
      label: "Comment",
      icon: "add_comment",
      shortcut: shortcutText("addComment"),
      disabled: !commentable,
      onSelect: actions.addComment,
    },
    "separator",
    { label: onLink ? "Edit link" : "Insert link", icon: "link", shortcut: shortcutText("insertLink"), onSelect: actions.insertLink },
    ...(onLink
      ? [
          { label: "Copy link", icon: "content_copy" as const, onSelect: () => onCopyLink(href!) },
          { label: "Remove link", icon: "link_off" as const, onSelect: () => run().extendMarkRange("link").unsetLink().run() },
        ]
      : []),
    "separator",
    {
      label: "Format options",
      icon: "format_paragraph",
      submenu: [
        textMenu(editor, actions),
        paragraphStylesMenu(editor, actions, currentParagraphStyle(editor)),
        alignAndIndentMenu(editor, actions),
        {
          label: "Line & paragraph spacing",
          icon: "format_line_spacing",
          submenu: lineSpacingEntries(editor, actions, paragraphSpacingAt(editor)),
        },
      ],
    },
    { label: "Clear formatting", icon: "format_clear", shortcut: shortcutText("clearFormatting"), onSelect: () => clearFormatting(editor) },
  ];
}
