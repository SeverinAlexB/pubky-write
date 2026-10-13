import { documentExtensions, paragraphStyleDefinitions, paragraphStyleOf } from "@docs/shared";
import { Extension, type AnyExtension, type Editor } from "@tiptap/core";
import type { Mark, Node } from "@tiptap/pm/model";
import { UndoRedo } from "@tiptap/extensions";
import { collab } from "prosemirror-collab";
import { clampFontSize, DEFAULT_FONT, parseFontSize, stepFontSize } from "./fonts.ts";
import { CommentAnchors, type CommentAnchor } from "./commentAnchors.ts";
import { Search } from "./search.ts";

type EditorExtensionOptions = {
  /** Server version of the loaded document. */
  version: number;
  clientId: string;
  onLinkShortcut: () => void;
  onCommentShortcut: () => void;
  comments: CommentAnchor[];
  onCommentClick: (id: number) => void;
};

/** The shared document schema plus the editor-only behaviour: undo, step tracking, search and shortcuts. */
export function editorExtensions({
  version,
  clientId,
  onLinkShortcut,
  onCommentShortcut,
  comments,
  onCommentClick,
}: EditorExtensionOptions): AnyExtension[] {
  return [
    ...documentExtensions,
    UndoRedo,
    Search,
    CommentAnchors.configure({ initial: comments, onActivate: onCommentClick }),
    Extension.create({
      name: "collab",
      addProseMirrorPlugins: () => [collab({ version, clientID: clientId })],
    }),
    Extension.create({
      name: "documentShortcuts",
      addKeyboardShortcuts() {
        return {
          "Mod-k": () => {
            onLinkShortcut();
            return true;
          },
          "Mod-Alt-m": () => {
            onCommentShortcut();
            return true;
          },
          "Mod-\\": () => clearFormatting(this.editor),
          "Mod-]": () => this.editor.commands.changeIndent(1) || true,
          "Mod-[": () => this.editor.commands.changeIndent(-1) || true,
          "Mod-Shift-.": () => changeFontSize(this.editor, 1),
          "Mod-Shift-,": () => changeFontSize(this.editor, -1),
        };
      },
    }),
    Extension.create({
      name: "tabIndent",
      // Lower than lists and tables, so Tab still nests list items and moves between cells.
      priority: 50,
      addKeyboardShortcuts() {
        return {
          // Like Docs, Tab never moves focus out of the document.
          // In a list Tab only changes the list level, so a list item that cannot move stays put.
          Tab: () => inList(this.editor) || this.editor.commands.changeIndent(1) || true,
          "Shift-Tab": () => inList(this.editor) || this.editor.commands.changeIndent(-1) || true,
        };
      },
    }),
  ];
}

function inList(editor: Editor): boolean {
  return editor.isActive("listItem") || editor.isActive("taskItem");
}

export function clearFormatting(editor: Editor): boolean {
  return editor.chain().focus().unsetAllMarks().setTextAlign("left").run();
}

/** The size of text without an explicit size: its paragraph style's size. */
function styleFontSize(block: Node): number {
  return paragraphStyleDefinitions[paragraphStyleOf(block)].fontSize;
}

/** The font size at the cursor in points, falling back to the paragraph style's size. */
export function currentFontSize(editor: Editor): number {
  const explicit = parseFontSize(editor.getAttributes("textStyle").fontSize);
  return explicit ?? styleFontSize(editor.state.selection.$from.parent);
}

/** The font size of all selected text, or null when it differs (the toolbar then shows no value). */
export function selectedFontSize(editor: Editor): number | null {
  return uniformTextValue(editor, (marks, block) => {
    const explicit = parseFontSize(marks.find((mark) => mark.type.name === "textStyle")?.attrs.fontSize);
    return explicit ?? styleFontSize(block);
  });
}

/** The font family of all selected text, or null when it differs. */
export function selectedFontFamily(editor: Editor): string | null {
  return uniformTextValue(
    editor,
    (marks) => (marks.find((mark) => mark.type.name === "textStyle")?.attrs.fontFamily as string | null) || DEFAULT_FONT,
  );
}

/** The value `read` gives for every piece of selected text (or at the cursor), or null when they differ. */
function uniformTextValue<T>(editor: Editor, read: (marks: readonly Mark[], block: Node) => T): T | null {
  const { selection, storedMarks, doc } = editor.state;
  if (selection.empty) return read(storedMarks ?? selection.$from.marks(), selection.$from.parent);
  const values = new Set<T>();
  doc.nodesBetween(selection.from, selection.to, (node, _pos, parent) => {
    if (node.isText && parent) values.add(read(node.marks, parent));
  });
  if (values.size === 0) return read(selection.$from.marks(), selection.$from.parent);
  return values.size === 1 ? [...values][0]! : null;
}

export function setFontSize(editor: Editor, size: number): boolean {
  return editor.chain().focus().setFontSize(`${clampFontSize(size)}pt`).run();
}

export function changeFontSize(editor: Editor, direction: 1 | -1): boolean {
  return setFontSize(editor, stepFontSize(currentFontSize(editor), direction));
}
