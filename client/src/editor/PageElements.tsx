// Headers, footers and footnotes drawn over the pages (see docs/design/page-elements.md).
// Positions come from the pagination's page layout; the one header, footer or footnote being
// edited is a region editor, the others are static copies of their content.
import {
  pageElementsOf,
  pageGeometry,
  pageSetupOf,
  regionFor,
  type PageElementSettings,
  type PageGeometry,
  type RegionContent,
} from "@docs/shared";
import { TextSelection } from "@tiptap/pm/state";
import { useEditorState, type Editor } from "@tiptap/react";
import { useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { Menu } from "../components/Menu.tsx";
import {
  createRegionEditor,
  footnoteBinding,
  headerBinding,
  placeRegionCursor,
  type RegionBinding,
  type RegionTarget,
} from "./pageElementCommands.ts";
import { currentTabId } from "./documentTabs.ts";
import { documentFootnotes, pageLayoutOf, type PageLayout } from "./pagination.ts";
import { layOutStaticWraps } from "./imageWrap.ts";
import { HEADER_OFFSET, regionHTML } from "./regionRender.ts";
import { layoutTabsIn } from "./tabLayout.ts";

type PageElementsProps = {
  editor: Editor;
  /** What is being edited, or null. Always null for a read-only preview. */
  target: RegionTarget | null;
  onTargetChange?: (target: RegionTarget | null) => void;
  /** The region editor while one is active, for the toolbar. */
  onRegionEditor?: (editor: Editor | null) => void;
  /** Options > Page numbers… */
  onPageNumbers?: (position: "header" | "footer") => void;
  /** A click on a suggestion in the header, footer or footnote being edited (its id), or elsewhere in it. */
  onActivateSuggestion?: (id: string | null) => void;
};

type PageElementsState = {
  layout: PageLayout | null;
  geometry: PageGeometry;
  settings: PageElementSettings;
  footnotes: RegionContent[];
  /** Per footnote: "insert" or "delete" when its reference is a suggestion, else "". */
  footnoteSuggestions: string;
};

function selectState({ editor }: { editor: Editor }): PageElementsState {
  const { doc } = editor.state;
  return {
    layout: pageLayoutOf(editor.state),
    geometry: pageGeometry(pageSetupOf(doc)),
    settings: pageElementsOf(doc),
    footnotes: documentFootnotes(editor.state).map((footnote) => footnote.node.attrs.content as RegionContent),
    footnoteSuggestions: documentFootnotes(editor.state)
      .map(({ node }) =>
        node.marks.some((mark) => mark.type.name === "suggestionDelete") ? "delete" : node.marks.some((mark) => mark.type.name === "suggestionInsert") ? "insert" : "",
      )
      .join(","),
  };
}

function sameState(a: PageElementsState, b: PageElementsState | null): boolean {
  if (!b) return false;
  const keys = Object.keys(a.settings) as (keyof PageElementSettings)[];
  const geometryKeys = Object.keys(a.geometry) as (keyof PageGeometry)[];
  return (
    a.layout === b.layout &&
    a.footnoteSuggestions === b.footnoteSuggestions &&
    geometryKeys.every((key) => a.geometry[key] === b.geometry[key]) &&
    keys.every((key) => a.settings[key] === b.settings[key]) &&
    a.footnotes.length === b.footnotes.length &&
    a.footnotes.every((content, index) => content === b.footnotes[index])
  );
}

export function PageElements({ editor, target, onTargetChange, onRegionEditor, onPageNumbers, onActivateSuggestion }: PageElementsProps) {
  const { layout, geometry, settings, footnotes, footnoteSuggestions } = useEditorState({ editor, selector: selectState, equalityFn: sameState });
  const footnoteSuggestion = footnoteSuggestions.split(",");
  const layer = useRef<HTMLDivElement>(null);
  const editingHeader = target && target.kind !== "footnote" ? target : null;

  // While a header or footer is edited, clicking another page's copy edits that one.
  useEffect(() => {
    const stack = layer.current?.parentElement;
    if (!stack || !editingHeader) return;
    stack.classList.add("is-editing-region");
    return () => stack.classList.remove("is-editing-region");
  }, [editingHeader !== null]);

  // Opening a header or footer scrolls it, with its band and the page's edge, into view.
  const scrollTarget = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    scrollTarget.current?.scrollIntoView({ block: "nearest" });
  }, [editingHeader?.kind, editingHeader?.page, layout !== null]);

  useEffect(() => {
    if (!target || !onTargetChange) return;
    const end = () => onTargetChange(null);
    editor.view.dom.addEventListener("mousedown", end);
    editor.on("focus", end);
    return () => {
      editor.view.dom.removeEventListener("mousedown", end);
      editor.off("focus", end);
    };
  }, [editor, target !== null, onTargetChange]);

  // Double-clicking the top or bottom margin of a page edits its header or footer.
  useEffect(() => {
    const stack = layer.current?.parentElement;
    if (!stack || !layout || !onTargetChange || !editor.isEditable) return;
    const onDoubleClick = (event: MouseEvent) => {
      const rect = stack.getBoundingClientRect();
      const scale = rect.width / geometry.width;
      const y = (event.clientY - rect.top) / scale;
      const stride = geometry.height + layout.gap;
      const page = Math.floor(y / stride);
      const within = y - page * stride;
      if (page < 0 || page >= layout.pageCount || within > geometry.height) return;
      const kind = within < (page === 0 ? layout.firstTop : layout.top) ? "header" : within > (page === 0 ? layout.firstBottom : layout.bottom) ? "footer" : null;
      if (!kind) return;
      // A footnote area sits above the bottom margin, so it is not part of the footer's area.
      if ((event.target as HTMLElement).closest(".footnote-area")) return;
      event.preventDefault();
      onTargetChange({ kind, page, at: { x: event.clientX, y: event.clientY } });
    };
    stack.addEventListener("dblclick", onDoubleClick);
    return () => stack.removeEventListener("dblclick", onDoubleClick);
  }, [editor, layout, geometry, onTargetChange]);

  const pages: ReactNode[] = [];
  if (layout) {
    const stride = geometry.height + layout.gap;
    const notesByPage = new Map<number, number[]>();
    footnotes.forEach((_content, index) => {
      const page = layout.footnotePages[index];
      if (page !== undefined) notesByPage.set(page, [...(notesByPage.get(page) ?? []), index]);
    });
    for (let page = 0; page < layout.pageCount; page++) {
      const pageTop = page * stride;
      const counters = { counterReset: `docs-page ${page + settings.pageNumberStart}` } as CSSProperties;
      for (const kind of ["header", "footer"] as const) {
        const editing = editingHeader?.kind === kind && editingHeader.page === page;
        const content = regionFor(settings, kind, page);
        if (!editing && !content) continue;
        const top = kind === "header" ? pageTop + HEADER_OFFSET : pageTop + geometry.height - HEADER_OFFSET;
        const binding = headerBinding(kind, page, settings.differentFirstPage);
        const regionBar = (barKind: "header" | "footer") => (
          <RegionBar
            editor={editor}
            kind={barKind}
            differentFirstPage={settings.differentFirstPage}
            onPageNumbers={onPageNumbers}
            onRemove={() => {
              onTargetChange?.(null);
              editor.chain().focus().command(({ tr }) => Boolean(tr.setDocAttribute(binding.key, null))).run();
            }}
          />
        );
        pages.push(
          <div
            key={`${kind}-${page}`}
            className={`page-region-slot is-${kind}${editing ? " is-editing" : ""}`}
            data-region-key={binding.key}
            style={{ ...counters, top }}
            onMouseDown={(event) => {
              // While a header or footer is edited, clicking another page's copy edits that one.
              if (editing || !editingHeader || !onTargetChange) return;
              event.preventDefault();
              onTargetChange({ kind, page, at: { x: event.clientX, y: event.clientY } });
            }}
          >
            {editing && <div ref={scrollTarget} className="region-scroll-target" />}
            {editing && kind === "footer" && regionBar(kind)}
            {editing ? (
              <RegionEditor
                main={editor}
                binding={binding}
                className=""
                at={editingHeader.at}
                onRegionEditor={onRegionEditor}
                onActivateSuggestion={onActivateSuggestion}
                onExit={() => {
                  onTargetChange?.(null);
                  editor.view.focus();
                }}
              />
            ) : (
              <StaticRegion editor={editor} content={content!} page={page + settings.pageNumberStart} pageCount={layout.pageCount} />
            )}
            {editing && kind === "header" && regionBar(kind)}
          </div>,
        );
      }
      const notes = notesByPage.get(page);
      if (notes) {
        pages.push(
          <div
            key={`footnotes-${page}`}
            className="footnote-area"
            style={{ top: pageTop + (page === 0 ? layout.firstBottom : layout.bottom) }}
            aria-label={`Footnotes on page ${page + 1}`}
            role="group"
          >
            <div className="footnote-separator" />
            {notes.map((index) => (
              <div
                key={index}
                className={`footnote-entry${footnoteSuggestion[index] ? ` is-suggested-${footnoteSuggestion[index]}` : ""}`}
                data-footnote-index={index}
              >
                <sup className="footnote-number">{index + 1}</sup>
                {target?.kind === "footnote" && target.index === index ? (
                  <RegionEditor
                    main={editor}
                    binding={footnoteBinding(index, currentTabId(editor.state))}
                    className="footnote-text"
                    at={target.at}
                    onRegionEditor={onRegionEditor}
                    onActivateSuggestion={onActivateSuggestion}
                    onExit={() => {
                      onTargetChange?.(null);
                      focusAfterFootnote(editor, index);
                    }}
                  />
                ) : (
                  <StaticRegion
                    editor={editor}
                    content={footnotes[index]!}
                    className="footnote-text"
                    onMouseDown={
                      onTargetChange && editor.isEditable
                        ? (event) => {
                            event.preventDefault();
                            onTargetChange({ kind: "footnote", index, at: { x: event.clientX, y: event.clientY } });
                          }
                        : undefined
                    }
                  />
                )}
              </div>
            ))}
          </div>,
        );
      }
    }
  }

  return (
    <div ref={layer} className="page-elements">
      {pages}
    </div>
  );
}

/** A copy of a header, footer or footnote; its page number and page count fields show `page` and `pageCount`. */
function StaticRegion({
  editor,
  content,
  page,
  pageCount,
  className = "",
  onMouseDown,
}: {
  editor: Editor;
  content: RegionContent;
  page?: number;
  pageCount?: number;
  className?: string;
  onMouseDown?: (event: ReactMouseEvent) => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const html = useMemo(() => regionHTML(editor.schema, content), [editor, content]);
  useLayoutEffect(() => {
    for (const field of element.current?.querySelectorAll<HTMLElement>(".page-field") ?? []) {
      const value = field.dataset.field === "count" ? pageCount : page;
      field.textContent = value === undefined ? "" : String(value);
    }
  }, [html, page, pageCount]);
  // Tabs and text on both sides of images depend on the page's width too, so they are laid out after every render.
  useLayoutEffect(() => {
    const container = element.current;
    if (!container) return;
    const stack = container.closest<HTMLElement>(".page-stack");
    const width = stack?.getBoundingClientRect().width ?? 0;
    if (width > 0) layOutStaticWraps(container, width / pageGeometry(pageSetupOf(editor.state.doc)).width);
    layoutTabsIn([container]);
  });
  return (
    <div
      ref={element}
      className={`page-content page-region ${className}`}
      onMouseDown={onMouseDown}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

type RegionEditorProps = {
  main: Editor;
  binding: RegionBinding;
  className: string;
  at?: { x: number; y: number };
  onRegionEditor?: (editor: Editor | null) => void;
  onActivateSuggestion?: (id: string | null) => void;
  onExit: () => void;
};

/** The editor of the header, footer or footnote being edited, created in place. */
function RegionEditor({ main, binding, className, at, onRegionEditor, onActivateSuggestion, onExit }: RegionEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const handlers = useRef({ onExit, onRegionEditor, onActivateSuggestion });
  handlers.current = { onExit, onRegionEditor, onActivateSuggestion };

  // Created while React commits, so keys typed right after the command that opened it land in it.
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const region = createRegionEditor({
      main,
      binding,
      element,
      className,
      onEscape: () => handlers.current.onExit(),
      onActivateSuggestion: handlers.current.onActivateSuggestion && ((id) => handlers.current.onActivateSuggestion?.(id)),
    });
    handlers.current.onRegionEditor?.(region);
    placeRegionCursor(region, at);
    return () => {
      handlers.current.onRegionEditor?.(null);
      region.destroy();
    };
  }, [main, binding.key]);

  // The editor's own element is the region; this wrapper only hosts it.
  return <div ref={host} className="region-editor-host" />;
}

type RegionBarProps = {
  editor: Editor;
  kind: "header" | "footer";
  differentFirstPage: boolean;
  onPageNumbers?: (position: "header" | "footer") => void;
  onRemove: () => void;
};

/** The line under the header (or above the footer) with its label, "Different first page" and Options. */
function RegionBar({ editor, kind, differentFirstPage, onPageNumbers, onRemove }: RegionBarProps) {
  const label = kind === "header" ? "Header" : "Footer";
  return (
    // Keeps the focus in the header or footer; the checkbox still toggles on click.
    <div className={`region-bar is-${kind}`} onMouseDown={(event) => event.preventDefault()}>
      <div className="region-bar-content">
        <span className="region-bar-label">{label}</span>
        <span className="region-bar-actions">
          <label>
            <input
              type="checkbox"
              checked={differentFirstPage}
              onChange={(event) => {
                const checked = event.target.checked;
                editor.view.dispatch(editor.state.tr.setDocAttribute("differentFirstPage", checked));
              }}
            />
            Different first page
          </label>
          <Menu
            label="Options"
            ariaLabel={`${label} options`}
            buttonClassName="text-menu-button"
            align="end"
            entries={[
              // Header format is not available yet (P2).
              { label: `${label} format…` },
              { label: "Page numbers…", onSelect: onPageNumbers && (() => onPageNumbers(kind)) },
              { label: `Remove ${kind}`, onSelect: onRemove },
            ]}
          />
        </span>
      </div>
    </div>
  );
}

/**
 * After leaving a footnote with Escape, the cursor goes after its reference. The focus moves
 * now (the focus command waits a frame), so keys typed right after Escape reach the body.
 */
function focusAfterFootnote(editor: Editor, index: number): void {
  const footnote = documentFootnotes(editor.state)[index];
  if (footnote) editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, footnote.pos + 1)));
  editor.view.focus();
}

