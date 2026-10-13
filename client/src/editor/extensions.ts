import { documentExtensions } from "@docs/shared";
import { Extension, type AnyExtension, type Editor } from "@tiptap/core";
import { UndoRedo } from "@tiptap/extensions";
import { collab } from "prosemirror-collab";
import { clampFontSize, defaultFontSizes, parseFontSize, stepFontSize } from "./fonts.ts";
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
          "Mod-\\": () => this.editor.chain().unsetAllMarks().setTextAlign("left").run(),
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
          Tab: () => this.editor.commands.changeIndent(1) || true,
          "Shift-Tab": () => this.editor.commands.changeIndent(-1) || true,
        };
      },
    }),
  ];
}

/** The font size at the cursor in points, falling back to the block's default size. */
export function currentFontSize(editor: Editor): number {
  const explicit = parseFontSize(editor.getAttributes("textStyle").fontSize);
  if (explicit) return explicit;
  const level = editor.getAttributes("heading").level as number | undefined;
  return defaultFontSizes[editor.isActive("heading") && level ? `h${level}` : "paragraph"]!;
}

export function setFontSize(editor: Editor, size: number): boolean {
  return editor.chain().focus().setFontSize(`${clampFontSize(size)}pt`).run();
}

export function changeFontSize(editor: Editor, direction: 1 | -1): boolean {
  return setFontSize(editor, stepFontSize(currentFontSize(editor), direction));
}
