import { DocsImage, DocsTable, documentExtensions, paragraphStyleDefinitions, paragraphStyleOf } from "@docs/shared";
import { Extension, type AnyExtension, type Editor } from "@tiptap/core";
import { NodeSelection, Plugin } from "@tiptap/pm/state";
import type { Mark, Node } from "@tiptap/pm/model";
import { UndoRedo } from "@tiptap/extensions";
import { collab } from "prosemirror-collab";
import { clampFontSize, DEFAULT_FONT, parseFontSize, stepFontSize } from "./fonts.ts";
import { CommentAnchors, type CommentAnchor } from "./commentAnchors.ts";
import { EditorImage } from "./imageView.ts";
import { Pagination } from "./pagination.ts";
import { Search } from "./search.ts";
import { followTocEntry } from "./pageElementCommands.ts";
import { Suggesting, type EditorMode } from "./suggesting.ts";
import { EditorTable, TableColumnResize } from "./tables.ts";
import { TabKey, TabLayout } from "./tabLayout.ts";

type EditorExtensionOptions = {
  /** Server version of the loaded document. */
  version: number;
  clientId: string;
  onLinkShortcut: () => void;
  onCommentShortcut: () => void;
  onFootnoteShortcut: () => void;
  comments: CommentAnchor[];
  commentsHidden: boolean;
  onCommentClick: (id: number | null) => void;
  mode: EditorMode;
  onSuggestionClick: (id: string | null) => void;
};

/** The shared document schema plus the editor-only behaviour: undo, step tracking, search, pages and shortcuts. */
export function editorExtensions({
  version,
  clientId,
  onLinkShortcut,
  onCommentShortcut,
  onFootnoteShortcut,
  comments,
  commentsHidden,
  onCommentClick,
  mode,
  onSuggestionClick,
}: EditorExtensionOptions): AnyExtension[] {
  return [
    // The shared schema, with the editor's own views of tables and images.
    ...documentExtensions.map((extension) =>
      extension === DocsTable ? EditorTable : extension === DocsImage ? EditorImage : extension,
    ),
    TableColumnResize,
    UndoRedo,
    Search,
    TabLayout,
    Pagination,
    CommentAnchors.configure({ initial: comments, initiallyHidden: commentsHidden, onActivate: onCommentClick }),
    // After the comment anchors, so a click on suggested text activates the suggestion's card.
    Suggesting.configure({ initialMode: mode, onActivate: onSuggestionClick }),
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
          "Mod-Alt-f": () => {
            onFootnoteShortcut();
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
    TocLinks,
    TabKey,
  ];
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

/**
 * A table of contents is one block: a click in it (other than on a link of the linked style, which
 * jumps to its heading) or a cursor moved into it selects the whole table.
 */
const TocLinks = Extension.create({
  name: "tocLinks",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleClick(view, _pos, event) {
            const target = event.target as HTMLElement | null;
            const toc = target?.closest?.(".toc");
            if (!toc || !view.dom.contains(toc)) return false;
            const tocPos = view.posAtDOM(toc, 0) - 1;
            const link = target?.closest('.toc[data-style="links"] .toc-text');
            const entry = link?.closest(".toc-entry");
            if (entry && followTocEntry(view, tocPos, Array.prototype.indexOf.call(toc.children, entry))) return true;
            if (view.state.doc.nodeAt(tocPos)?.type.name !== "tableOfContents") return false;
            view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, tocPos)));
            return true;
          },
        },
        appendTransaction(_transactions, _old, state) {
          const { selection } = state;
          if (selection instanceof NodeSelection) return null;
          const { $from, $to } = selection;
          for (let depth = $from.depth; depth > 0; depth--) {
            if ($from.node(depth).type.name !== "tableOfContents") continue;
            // A selection that only starts in the table (dragged out of it) is left alone.
            if (!selection.empty && $to.pos > $from.end(depth)) return null;
            return state.tr.setSelection(NodeSelection.create(state.doc, $from.before(depth)));
          }
          return null;
        },
      }),
    ];
  },
});
