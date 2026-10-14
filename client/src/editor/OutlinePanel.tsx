// The tabs and outline sidebar: the document's single tab and an outline of its headings.
import type { Node } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { Icon } from "../components/Icon.tsx";

/** A heading in the outline; level 0 is the Title. */
export type OutlineHeading = { level: number; text: string; pos: number };

// The outline of each document, kept while the editor shows it: the selector runs on every transaction.
const outlines = new WeakMap<Node, OutlineHeading[]>();

/** Title and Heading 1–6 blocks with text, in document order. */
export function outlineHeadings(doc: Node): OutlineHeading[] {
  const cached = outlines.get(doc);
  if (cached) return cached;
  const headings: OutlineHeading[] = [];
  doc.descendants((node, pos) => {
    const level = node.type.name === "heading" ? (node.attrs.level as number) : node.attrs.paragraphStyle === "title" ? 0 : null;
    if (level !== null && node.isTextblock) {
      const text = node.textContent.trim();
      if (text) headings.push({ level, text, pos });
    }
    return node.isBlock && !node.isTextblock; // headings only live at block level
  });
  outlines.set(doc, headings);
  return headings;
}

/** The round button at the top left of the editor area that opens the sidebar. */
export function OutlineToggle({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      className="outline-toggle"
      aria-label="Show tabs and outlines"
      data-tooltip="Show tabs and outlines"
      onClick={onOpen}
    >
      <Icon name="list" />
    </button>
  );
}

type OutlinePanelProps = {
  editor: Editor;
  openComments: number;
  onClose: () => void;
};

export function OutlinePanel({ editor, openComments, onClose }: OutlinePanelProps) {
  const { headings, currentPos } = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const headings = outlineHeadings(current.state.doc);
      const cursor = current.state.selection.from;
      return { headings, currentPos: headings.findLast((heading) => heading.pos < cursor)?.pos ?? null };
    },
  });
  const topLevel = Math.min(...headings.map((heading) => heading.level));

  const jumpTo = (heading: OutlineHeading) => {
    editor.chain().focus().setTextSelection(heading.pos + 1).run();
    // Bring the heading to the top of the view, past any page spacer before it.
    const dom = editor.view.nodeDOM(heading.pos);
    if (dom instanceof HTMLElement) dom.scrollIntoView({ block: "start" });
  };

  return (
    <aside className="outline-panel" aria-label="Tabs and outlines">
      <button
        type="button"
        className="icon-button outline-back"
        aria-label="Hide tabs and outlines"
        data-tooltip="Hide tabs and outlines"
        onClick={onClose}
      >
        <Icon name="arrow_back" />
      </button>
      <h2 className="outline-heading">Document tabs</h2>
      <div className="outline-tab is-current" aria-current="page">
        <Icon name="description" />
        <span className="outline-tab-name">Tab 1</span>
        {openComments > 0 && (
          <span className="outline-tab-badge" aria-label={`${openComments} open comments`} title={`${openComments} open comments`}>
            {openComments}
          </span>
        )}
        {/* Renaming tabs is P2. */}
        <button type="button" className="icon-button outline-tab-menu" aria-label="Tab options" disabled>
          <Icon name="more_vert" />
        </button>
      </div>
      {headings.length === 0 ? (
        <p className="outline-empty">Headings that you add to the document will appear here.</p>
      ) : (
        <ol className="outline-list" aria-label="Outline">
          {headings.map((heading, index) => {
            const current = heading.pos === currentPos;
            return (
              // By index: typing above a heading moves its position, which would recreate every item after it.
              <li key={index} className={current ? "is-current" : undefined}>
                <button
                  type="button"
                  className="outline-item"
                  style={{ paddingLeft: 16 + (heading.level - topLevel) * 12 }}
                  data-level={heading.level}
                  aria-current={current ? "location" : undefined}
                  title={heading.text}
                  onClick={() => jumpTo(heading)}
                >
                  {heading.text}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </aside>
  );
}
