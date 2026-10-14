// Editing headers, footers and footnotes in a region editor, and the Insert > Page elements
// commands. See docs/design/page-elements.md.
import {
  documentExtensions,
  emptyRegion,
  pageElementsOf,
  regionKeyFor,
  regionProblem,
  tableOfContents,
  tocEntries,
  tocTarget,
  type RegionContent,
  type RegionKey,
  type TocStyle,
} from "@docs/shared";
import { Editor, Extension, type JSONContent } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { NodeSelection, Plugin, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { closeHistory } from "@tiptap/pm/history";
import { documentFootnotes, layOutNow, pageIndexAt } from "./pagination.ts";
import { TabKey, TabLayout } from "./tabLayout.ts";

/** What is being edited: a page's header or footer, or footnote number index + 1. */
export type RegionTarget =
  | { kind: "header" | "footer"; page: number; at?: { x: number; y: number } }
  | { kind: "footnote"; index: number; at?: { x: number; y: number } };

/** How a region editor reads and writes its content in the main document. */
export type RegionBinding = {
  /** Changes when the editor is bound to different content (it is then created again). */
  key: string;
  kind: "header" | "footnote";
  label: string;
  /** The stored content: null for a header that has none yet, undefined when the content is gone. */
  read: (state: EditorState) => RegionContent | null | undefined;
  write: (tr: Transaction, content: RegionContent) => Transaction | null;
};

export function headerBinding(kind: "header" | "footer", page: number, differentFirstPage: boolean): RegionBinding {
  const key: RegionKey = regionKeyFor(kind, page, differentFirstPage);
  const first = key === "firstPageHeader" || key === "firstPageFooter";
  return {
    key,
    kind: "header",
    label: first ? `First page ${kind}` : kind === "header" ? "Header" : "Footer",
    read: (state) => (Array.isArray(state.doc.attrs[key]) ? (state.doc.attrs[key] as RegionContent) : null),
    write: (tr, content) => tr.setDocAttribute(key, content),
  };
}

export function footnoteBinding(index: number): RegionBinding {
  return {
    key: `footnote-${index}`,
    kind: "footnote",
    label: `Footnote ${index + 1}`,
    read: (state) => documentFootnotes(state.doc)[index]?.node.attrs.content as RegionContent | undefined,
    write: (tr, content) => {
      const footnote = documentFootnotes(tr.doc)[index];
      return footnote ? tr.setNodeAttribute(footnote.pos, "content", content) : null;
    },
  };
}

// Undo history: a region's keystrokes are attribute steps, whose empty step maps never count as
// "adjacent" to the previous edit, so the history would make each its own undo step. Steps that
// share a `composition` id are grouped instead. Negative ids never clash with the view's own.
let lastComposition = 0;
export function newUndoGroup(): number {
  lastComposition -= 1;
  return lastComposition;
}

/** Typing pauses longer than this start a new undo step, as in the main editor. */
const UNDO_GROUP_DELAY = 500;

const fromMain = "regionFromMain";

type RegionEditorOptions = {
  main: Editor;
  binding: RegionBinding;
  element: HTMLElement;
  className: string;
  onEscape: () => void;
};

/**
 * Creates the editor for a header, footer or footnote. Its changes become transactions on the
 * main editor; changes of the main document (undo, redo, restore) are copied back.
 */
export function createRegionEditor({ main, binding, element, className, onEscape }: RegionEditorOptions): Editor {
  let stored = binding.read(main.state) ?? null;
  let group = 0;
  let lastChange = 0;

  const region: Editor = new Editor({
    element,
    extensions: [...documentExtensions, TabLayout, TabKey, regionBehaviour(main, binding.kind, onEscape)],
    content: { type: "doc", content: stored ?? emptyRegion() },
    editorProps: {
      attributes: { class: `page-content page-region ${className}`, "aria-label": binding.label, role: "textbox", "aria-multiline": "true" },
    },
    onTransaction: ({ transaction }) => {
      if (!transaction.docChanged || transaction.getMeta(fromMain)) return;
      const content = region.state.doc.content.toJSON() as RegionContent;
      const now = Date.now();
      if (!group || now - lastChange > UNDO_GROUP_DELAY) group = newUndoGroup();
      lastChange = now;
      const tr = binding.write(main.state.tr, content);
      if (!tr) return;
      stored = content;
      main.view.dispatch(tr.setMeta("composition", group));
    },
  });

  const onMainTransaction = () => {
    if (region.isDestroyed) return;
    const content = binding.read(main.state);
    if (content === undefined || content === stored) return;
    stored = content;
    replaceRegionContent(region, content ?? emptyRegion());
  };
  main.on("transaction", onMainTransaction);
  region.on("destroy", () => main.off("transaction", onMainTransaction));
  return region;
}

/** Replaces only what differs, so the cursor stays where it was. */
function replaceRegionContent(region: Editor, content: RegionContent): void {
  const target = region.schema.nodeFromJSON({ type: "doc", content });
  const current = region.state.doc;
  const start = current.content.findDiffStart(target.content);
  if (start === null) return;
  let { a: endA, b: endB } = current.content.findDiffEnd(target.content)!;
  const overlap = start - Math.min(endA, endB);
  if (overlap > 0) {
    endA += overlap;
    endB += overlap;
  }
  region.view.dispatch(region.state.tr.replace(start, endA, target.slice(start, endB)).setMeta(fromMain, true));
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    regionUndo: {
      undo: () => ReturnType;
      redo: () => ReturnType;
    };
  }
}

/** Undo and redo go to the main editor; page breaks, footnotes and tables of contents are not allowed. */
function regionBehaviour(main: Editor, kind: "header" | "footnote", onEscape: () => void) {
  return Extension.create({
    name: "regionBehaviour",
    priority: 1000,
    addCommands() {
      return {
        undo:
          () =>
          ({ dispatch }) =>
            dispatch ? main.commands.undo() : main.can().undo(),
        redo:
          () =>
          ({ dispatch }) =>
            dispatch ? main.commands.redo() : main.can().redo(),
      };
    },
    addKeyboardShortcuts() {
      return {
        "Mod-z": () => main.commands.undo() || true,
        "Mod-y": () => main.commands.redo() || true,
        "Shift-Mod-z": () => main.commands.redo() || true,
        Escape: () => {
          onEscape();
          return true;
        },
        "Mod-Enter": () => true,
        "Mod-Alt-f": () => true,
      };
    },
    addProseMirrorPlugins() {
      return [new Plugin({ filterTransaction: (tr) => !tr.docChanged || regionProblem(tr.doc, kind) === null })];
    },
  });
}

/** Places the cursor at a point of the window, or at the end. */
export function placeRegionCursor(region: Editor, at?: { x: number; y: number }): void {
  const pos = at ? region.view.posAtCoords({ left: at.x, top: at.y })?.pos : undefined;
  region.chain().focus(pos ?? "end", { scrollIntoView: false }).run();
}

// ---------------------------------------------------------------------------------------------
// Page numbers

export type PageNumberOptions = { position: "header" | "footer"; showOnFirstPage: boolean; start?: number };

/** The page number options shown in the dialog for the current document. */
export function currentPageNumberOptions(doc: Node, position?: "header" | "footer"): Required<PageNumberOptions> {
  const settings = pageElementsOf(doc);
  const hasNumber = (content: RegionContent | null) => JSON.stringify(content ?? []).includes('"pageField"');
  const detected = hasNumber(settings.header) ? "header" : hasNumber(settings.footer) ? "footer" : "header";
  const chosen = position ?? detected;
  const first = chosen === "header" ? settings.firstPageHeader : settings.firstPageFooter;
  return {
    position: chosen,
    showOnFirstPage: !settings.differentFirstPage || hasNumber(first),
    start: settings.pageNumberStart,
  };
}

/** Adds page numbers at the right of the header or footer: one undo step. */
export function addPageNumbers(state: EditorState, { position, showOnFirstPage, start }: PageNumberOptions): Transaction {
  const tr = state.tr;
  const settings = pageElementsOf(state.doc);
  const firstKey = position === "header" ? "firstPageHeader" : "firstPageFooter";
  tr.setDocAttribute(position, withPageNumber(settings[position]));
  if (!showOnFirstPage) {
    if (!settings.differentFirstPage) tr.setDocAttribute("differentFirstPage", true);
    const first = settings[firstKey] && withoutPageNumbers(settings[firstKey]);
    if (first !== settings[firstKey]) tr.setDocAttribute(firstKey, first);
  } else if (settings.differentFirstPage) {
    tr.setDocAttribute(firstKey, withPageNumber(settings[firstKey]));
  }
  if (start !== undefined && start !== settings.pageNumberStart) tr.setDocAttribute("pageNumberStart", start);
  return tr;
}

const pageNumberParagraph = (): JSONContent => ({
  type: "paragraph",
  attrs: { textAlign: "right" },
  content: [{ type: "pageField", attrs: { kind: "page" } }],
});

function withPageNumber(content: RegionContent | null): RegionContent {
  if (!content || content.every((block) => block.type === "paragraph" && !block.content?.length)) return [pageNumberParagraph()];
  if (JSON.stringify(content).includes('"kind":"page"')) return content;
  return [...content, pageNumberParagraph()];
}

/** The content without page number fields; null when nothing is left. */
function withoutPageNumbers(content: RegionContent): RegionContent | null {
  const strip = (node: JSONContent): JSONContent => ({
    ...node,
    ...(node.content && {
      content: node.content.filter((child) => !(child.type === "pageField" && child.attrs?.kind !== "count")).map(strip),
    }),
  });
  const result = content.map(strip);
  return result.every((block) => block.type === "paragraph" && !block.content?.length) ? null : result;
}

// ---------------------------------------------------------------------------------------------
// Footnotes

/**
 * Inserts a footnote reference after the selection; returns the new footnote's index, or null
 * where a footnote cannot go (a code block, a table of contents).
 */
export function insertFootnote(editor: Editor): number | null {
  const { state } = editor;
  const type = state.schema.nodes.footnote!;
  const pos = state.selection.to;
  const $pos = state.doc.resolve(pos);
  if (!$pos.parent.inlineContent || !$pos.parent.canReplaceWith($pos.index(), $pos.index(), type)) return null;
  const tr = state.tr.insert(pos, type.create());
  tr.setSelection(TextSelection.create(tr.doc, pos + 1));
  closeHistory(tr);
  editor.view.dispatch(tr);
  // The footnote's text is edited at the bottom of its page, so that page has to be known now.
  layOutNow(editor.view);
  return documentFootnotes(editor.state.doc).findIndex((footnote) => footnote.pos === pos);
}

// ---------------------------------------------------------------------------------------------
// Table of contents

/** The page number shown for a position: its page in the current layout plus the numbering start. */
function pageNumberOf(view: EditorView): (pos: number) => number {
  const start = pageElementsOf(view.state.doc).pageNumberStart;
  return (pos) => pageIndexAt(view, pos) + start;
}

/** Inserts a table of contents at the cursor. */
export function insertTableOfContents(editor: Editor, style: TocStyle): void {
  const group = newUndoGroup();
  const json = tableOfContents(editor.state.doc, style, pageNumberOf(editor.view));
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      closeHistory(tr);
      tr.setMeta("composition", group);
      return true;
    })
    .insertContent(json)
    .run();
  correctTocPages(editor, group);
}

/** The table of contents at the selection: selected, or containing the cursor. */
export function selectedToc(state: EditorState): { node: Node; pos: number } | null {
  const { selection } = state;
  if (selection instanceof NodeSelection && selection.node.type.name === "tableOfContents") {
    return { node: selection.node, pos: selection.from };
  }
  const $from = selection.$from;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === "tableOfContents") return { node: $from.node(depth), pos: $from.before(depth) };
  }
  return null;
}

/** "Update table of contents": lists the current headings with their current pages. */
export function updateTableOfContents(editor: Editor): void {
  const toc = selectedToc(editor.state);
  if (!toc) return;
  const group = newUndoGroup();
  const entries = tocEntries(editor.state.doc, pageNumberOf(editor.view)).map((entry) => editor.schema.nodeFromJSON(entry));
  const tr = editor.state.tr.replaceWith(toc.pos + 1, toc.pos + toc.node.nodeSize - 1, entries);
  tr.setSelection(NodeSelection.create(tr.doc, toc.pos));
  closeHistory(tr);
  editor.view.dispatch(tr.setMeta("composition", group));
  editor.commands.focus(undefined, { scrollIntoView: false });
  correctTocPages(editor, group);
}

export function deleteTableOfContents(editor: Editor): void {
  const toc = selectedToc(editor.state);
  if (!toc) return;
  editor.chain().focus().deleteRange({ from: toc.pos, to: toc.pos + toc.node.nodeSize }).run();
}

/**
 * The table itself moves the headings after it, so its page numbers are only right once the
 * pages are laid out again. This lays them out and sets the numbers, in the same undo step.
 */
function correctTocPages(editor: Editor, group: number): void {
  layOutNow(editor.view);
  const tr = tocPageTransaction(editor);
  if (tr) editor.view.dispatch(tr.setMeta("composition", group));
}

function tocPageTransaction(editor: Editor): Transaction | null {
  const { doc } = editor.state;
  const pageOf = pageNumberOf(editor.view);
  const tr = editor.state.tr;
  doc.descendants((node, pos) => {
    if (node.type.name !== "tableOfContents") return true;
    node.forEach((entry, offset, index) => {
      const heading = tocTarget(doc, node, index);
      if (!heading || entry.attrs.page === null) return;
      const page = pageOf(heading.pos);
      if (page !== entry.attrs.page) tr.setNodeAttribute(pos + 1 + offset, "page", page);
    });
    return false;
  });
  return tr.docChanged ? tr : null;
}

/** Moves the cursor to the heading a table of contents entry links to. */
export function followTocEntry(view: EditorView, tocPos: number, entryIndex: number): boolean {
  const toc = view.state.doc.nodeAt(tocPos);
  if (!toc || toc.attrs.style !== "links") return false;
  const heading = tocTarget(view.state.doc, toc, entryIndex);
  if (!heading) return false;
  const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, heading.pos + 1));
  view.dispatch(tr);
  view.focus();
  const { node } = view.domAtPos(heading.pos + 1);
  (node instanceof HTMLElement ? node : node.parentElement)?.scrollIntoView({ block: "start" });
  return true;
}
