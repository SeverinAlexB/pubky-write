import type { Editor } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { cursorPage } from "./pagination.ts";
import { documentStats, formatCount } from "./textStats.ts";

type WordCountDialogProps = {
  editor: Editor;
  liveCountVisible: boolean;
  onConfirm: (liveCountVisible: boolean) => void;
  onCancel: () => void;
};

/** Tools > Word count (⌘⇧C). Shows "selection of total" when text is selected. */
export function WordCountDialog({ editor, liveCountVisible, onConfirm, onCancel }: WordCountDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [showLive, setShowLive] = useState(liveCountVisible);
  useEffect(() => dialog.current?.showModal(), []);

  const stats = documentStats(editor.state);
  const pages = cursorPage(editor.view);
  const rows: [string, string][] = [
    ["Pages", `${pages.page} of ${pages.count}`],
    ["Words", formatCount(stats, "words")],
    ["Characters", formatCount(stats, "characters")],
    ["Characters excluding spaces", formatCount(stats, "charactersExcludingSpaces")],
  ];

  return (
    <dialog
      ref={dialog}
      className="dialog word-count-dialog"
      aria-labelledby="word-count-title"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <h2 id="word-count-title">Word count</h2>
      <table className="word-count">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <label className="checkbox-option word-count-live">
        <input type="checkbox" checked={showLive} onChange={(event) => setShowLive(event.target.checked)} />
        Display word count while typing
      </label>
      <div className="dialog-actions">
        <button type="button" className="button-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="button-primary" autoFocus onClick={() => onConfirm(showLive)}>
          OK
        </button>
      </div>
    </dialog>
  );
}
