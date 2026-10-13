import type { Mark } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";
import { useEffect, useState } from "react";

/**
 * Paint format: copies the character formatting at the selection; the next text
 * selected with the mouse receives it. Started with a double-click, it stays on
 * until Escape or another click on the button.
 */
export function usePaintFormat(editor: Editor) {
  const [painting, setPainting] = useState<{ marks: readonly Mark[]; sticky: boolean } | null>(null);

  useEffect(() => {
    if (!painting) return;
    const dom = editor.view.dom;
    const paint = () => {
      // Runs after the editor has read the selection made by this mouse-up.
      setTimeout(() => {
        const { from, to, empty } = editor.state.selection;
        if (empty) return;
        const tr = editor.state.tr.removeMark(from, to);
        for (const mark of painting.marks) tr.addMark(from, to, mark);
        editor.view.dispatch(tr);
        if (!painting.sticky) setPainting(null);
      });
    };
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPainting(null);
    };
    dom.classList.add("is-painting");
    dom.addEventListener("mouseup", paint);
    document.addEventListener("keydown", cancel);
    return () => {
      dom.classList.remove("is-painting");
      dom.removeEventListener("mouseup", paint);
      document.removeEventListener("keydown", cancel);
    };
  }, [editor, painting]);

  const start = (sticky: boolean) =>
    setPainting((current) => (current && !sticky ? null : { marks: marksAtSelection(editor), sticky }));

  return { active: painting !== null, start };
}

function marksAtSelection(editor: Editor): readonly Mark[] {
  const { selection, storedMarks, doc } = editor.state;
  const first = selection.empty ? null : doc.nodeAt(selection.from);
  return first?.isText ? first.marks : (storedMarks ?? selection.$from.marks());
}
