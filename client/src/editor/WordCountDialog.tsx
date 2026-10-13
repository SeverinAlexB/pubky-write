import type { Editor } from "@tiptap/react";
import { useEffect, useRef } from "react";
import { countText } from "./textStats.ts";

/** Tools > Word count (⌘⇧C). Shows selection counts alongside the totals when text is selected. */
export function WordCountDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => dialog.current?.showModal(), []);

  const { doc, selection } = editor.state;
  const total = countText(doc.textBetween(0, doc.content.size, "\n", "\n"));
  const selected = selection.empty ? null : countText(doc.textBetween(selection.from, selection.to, "\n", "\n"));
  const value = (key: keyof typeof total) =>
    selected ? `${selected[key].toLocaleString()} of ${total[key].toLocaleString()}` : total[key].toLocaleString();

  return (
    <dialog ref={dialog} className="dialog" aria-labelledby="word-count-title" onClose={onClose} onCancel={onClose}>
      <h2 id="word-count-title">Word count</h2>
      <table className="word-count">
        <tbody>
          <tr>
            <th scope="row">Words</th>
            <td>{value("words")}</td>
          </tr>
          <tr>
            <th scope="row">Characters</th>
            <td>{value("characters")}</td>
          </tr>
          <tr>
            <th scope="row">Characters excluding spaces</th>
            <td>{value("charactersExcludingSpaces")}</td>
          </tr>
        </tbody>
      </table>
      <div className="dialog-actions">
        <button type="button" className="button-primary" autoFocus onClick={onClose}>
          OK
        </button>
      </div>
    </dialog>
  );
}
