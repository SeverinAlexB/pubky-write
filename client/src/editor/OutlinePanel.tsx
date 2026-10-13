import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { Icon } from "../components/Icon.tsx";

type Heading = { level: number; text: string; pos: number };

/** The document outline: every heading, with the one containing the cursor highlighted. */
export function OutlinePanel({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const { headings, currentPos } = useEditorState({
    editor,
    selector: ({ editor }) => {
      const headings: Heading[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "heading") headings.push({ level: node.attrs.level, text: node.textContent, pos });
        return node.isBlock && !node.isTextblock; // headings only live at block level
      });
      const cursor = editor.state.selection.from;
      const current = headings.findLast((heading) => heading.pos < cursor);
      return { headings, currentPos: current?.pos ?? null };
    },
  });

  const jumpTo = (heading: Heading) => {
    editor.chain().focus().setTextSelection(heading.pos + 1).scrollIntoView().run();
    // Bring the heading to the top, as Docs does, rather than just into view.
    const dom = editor.view.nodeDOM(heading.pos);
    if (dom instanceof HTMLElement) dom.scrollIntoView({ block: "start" });
  };

  return (
    <aside className="outline-panel" aria-label="Document outline">
      <div className="outline-header">
        <h2>Outline</h2>
        <button type="button" className="icon-button small" aria-label="Close outline" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      {headings.length === 0 ? (
        <p className="outline-empty">Headings that you add to the document will appear here.</p>
      ) : (
        <ol className="outline-list">
          {headings.map((heading) => (
            <li key={heading.pos}>
              <button
                type="button"
                className={`outline-item outline-level-${heading.level}${heading.pos === currentPos ? " is-current" : ""}`}
                aria-current={heading.pos === currentPos ? "location" : undefined}
                onClick={() => jumpTo(heading)}
              >
                {heading.text || "Untitled heading"}
              </button>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
