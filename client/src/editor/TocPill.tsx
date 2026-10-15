// The pill at the top left of a table of contents while it is selected: Update, and ⋮ Delete.
import type { Editor } from "@tiptap/react";
import { useEffect, useState } from "react";
import { Icon } from "../components/Icon.tsx";
import { Menu } from "../components/Menu.tsx";
import { deleteTableOfContents, selectedToc, updateTableOfContents } from "./pageElementCommands.ts";
import { clientRect } from "./rects.ts";

type Position = { left: number; top: number };

export function TocPill({ editor, column }: { editor: Editor; column: HTMLElement | null }) {
  const [position, setPosition] = useState<Position | null>(null);

  useEffect(() => {
    if (!column) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      setPosition((previous) => {
        const next = pillPosition(editor, column);
        return next && previous && next.left === previous.left && next.top === previous.top ? previous : next;
      });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    editor.on("transaction", schedule);
    editor.on("focus", schedule);
    editor.on("blur", schedule);
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      editor.off("transaction", schedule);
      editor.off("focus", schedule);
      editor.off("blur", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [editor, column]);

  if (!position) return null;
  return (
    <div
      className="toc-pill"
      role="toolbar"
      aria-label="Table of contents actions"
      style={position}
      // Keep the table of contents selected.
      onMouseDown={(event) => event.preventDefault()}
    >
      <button
        type="button"
        className="icon-button"
        aria-label="Update table of contents"
        data-tooltip="Update table of contents"
        onClick={() => updateTableOfContents(editor)}
      >
        <Icon name="refresh" />
      </button>
      <Menu
        label={<Icon name="more_vert" />}
        ariaLabel="More table of contents options"
        buttonClassName="icon-button"
        entries={[{ label: "Delete table of contents", icon: "delete", onSelect: () => deleteTableOfContents(editor) }]}
      />
    </div>
  );
}

function pillPosition(editor: Editor, column: HTMLElement): Position | null {
  if (editor.isDestroyed || !editor.view.hasFocus()) return null;
  const toc = selectedToc(editor.state);
  const element = toc && editor.view.nodeDOM(toc.pos);
  if (!(element instanceof HTMLElement)) return null;
  const rect = clientRect(element);
  const columnRect = column.getBoundingClientRect();
  return { left: Math.round(rect.left - columnRect.left), top: Math.round(rect.top - columnRect.top) };
}
