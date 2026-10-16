// Review suggested edits > Preview reject all: the document as if every suggestion were rejected
// (spec 16, round 5 amendment). A CSS view of the editor can hide inserted text but cannot restore
// earlier formatting, paragraphs, lists or image settings, so the rejected document itself is shown,
// read-only, in pages of its own in place of the editor's (see docs/design/suggesting.md).
import { DocsEquation, DocsImage, DocsTable, documentExtensions, rejectedDocument, type Suggestion } from "@docs/shared";
import type { Node } from "@tiptap/pm/model";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { useEffect, useMemo, useRef } from "react";
import { currentTabId, DocumentTabs, switchTab } from "./documentTabs.ts";
import { EditorImage } from "./imageView.ts";
import { EditorEquation } from "./equations/equations.ts";
import { PageElements } from "./PageElements.tsx";
import { Pagination, resetPagination } from "./pagination.ts";
import { TabLayout } from "./tabLayout.ts";
import { EditorTable } from "./tables.ts";

type RejectPreviewProps = {
  editor: Editor;
  zoom: number;
  printLayout: boolean;
  /** A suggestion selected in Review suggested edits, to scroll to (a new object each time). */
  scrollTarget: { suggestion: Suggestion } | null;
  /** The preview's page stack, for the rulers. */
  onStack?: (stack: HTMLDivElement | null) => void;
};

export function RejectPreview({ editor, zoom, printLayout, scrollTarget, onStack }: RejectPreviewProps) {
  const doc = useEditorState({ editor, selector: ({ editor: current }) => current.state.doc, equalityFn: (a, b) => a === b });
  const tabId = useEditorState({ editor, selector: ({ editor: current }) => currentTabId(current.state) });
  const rejected = useMemo(() => rejectedDocument(doc), [doc]);
  // Rejecting a suggestion while previewing changes nothing here: keep the shown document then.
  const shown = useRef<Node | null>(null);
  if (!shown.current || !shown.current.eq(rejected.doc)) shown.current = rejected.doc;
  const content = shown.current;

  const preview = useEditor(
    {
      extensions: [
        // The editor's own views of tables and images, so they are laid out as in the editor.
        ...documentExtensions.map((extension) =>
          extension === DocsTable
            ? EditorTable
            : extension === DocsImage
              ? EditorImage
              : extension === DocsEquation
                ? EditorEquation.configure({ editable: false })
                : extension,
        ),
        DocumentTabs.configure({ initialTab: tabId }),
        TabLayout,
        Pagination,
      ],
      content: content.toJSON(),
      editable: false,
      editorProps: { attributes: { class: "page-content", "aria-label": "Preview of rejecting all suggestions" } },
    },
    [content],
  );

  useEffect(() => {
    const tr = switchTab(preview.state, tabId);
    if (tr) preview.view.dispatch(tr);
  }, [preview, tabId]);

  useEffect(() => {
    if (!preview.isDestroyed) resetPagination(preview.view, printLayout);
  }, [preview, zoom, printLayout]);

  const stack = useRef<HTMLDivElement>(null);
  useEffect(() => {
    onStack?.(stack.current);
    return () => onStack?.(null);
  }, [onStack]);
  useEffect(() => {
    if (!scrollTarget || preview.isDestroyed) return;
    const { suggestion } = scrollTarget;
    // Once the pages are laid out.
    const frame = requestAnimationFrame(() => {
      let target: Element | null;
      if (suggestion.region) {
        const key = suggestion.region.key;
        target = stack.current?.querySelector(key === "footnote" ? ".footnote-area" : `.page-region-slot[data-region-key="${key}"]`) ?? null;
      } else {
        const pos = Math.min(rejected.mapping.map(suggestion.from, -1) + 1, preview.state.doc.content.size);
        const { node } = preview.view.domAtPos(pos);
        target = node instanceof Element ? node : node.parentElement;
      }
      target?.scrollIntoView({ block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollTarget, preview]);

  return (
    <div ref={stack} className={`page-stack is-reject-preview${printLayout ? "" : " is-pageless"}`} style={{ zoom }}>
      {/* One sheet per page, drawn by the pagination plugin. */}
      <div className="page-sheets" aria-hidden />
      <EditorContent editor={preview} />
      <PageElements editor={preview} target={null} />
    </div>
  );
}
