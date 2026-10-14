import { useEffect, useRef } from "react";
import { entryText, pendingStore, type PendingEntry } from "./pendingSteps.ts";

type UnsavedChangesDialogProps = {
  /** The kept edits that could not be restored. */
  entries: PendingEntry[];
  documentTitle: string;
  /** The document no longer exists (the edits cannot be restored into it). */
  deleted?: boolean;
  onClose: () => void;
};

/**
 * Edits kept in the browser that could not be restored: download their text as a file, or
 * discard them. Either way they are removed from the browser.
 */
export function UnsavedChangesDialog({ entries, documentTitle, deleted = false, onClose }: UnsavedChangesDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => dialog.current?.showModal(), []);

  const finish = async () => {
    await Promise.all(entries.map((entry) => pendingStore.remove(entry.key))).catch(() => {});
    onClose();
  };

  const download = () => {
    const text = entries.map(entryText).join("\n\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    link.download = `${documentTitle || "Untitled document"} (unsaved changes).txt`;
    link.click();
    URL.revokeObjectURL(link.href);
    void finish();
  };

  return (
    <dialog
      ref={dialog}
      className="dialog"
      aria-labelledby="unsaved-changes-title"
      aria-describedby="unsaved-changes-message"
      onCancel={(event) => event.preventDefault()}
    >
      <h2 id="unsaved-changes-title">Couldn't restore unsaved changes</h2>
      <p id="unsaved-changes-message" className="dialog-message">
        {deleted
          ? "Changes to this document were kept in this browser while it was offline, but the document no longer exists."
          : "Changes kept in this browser while it was offline could not be added to the document."}{" "}
        Download them as a text file to keep them.
      </p>
      <div className="dialog-actions">
        <button type="button" className="button-secondary" onClick={() => void finish()}>
          Discard
        </button>
        <button type="button" className="button-primary" autoFocus onClick={download}>
          Download unsaved text
        </button>
      </div>
    </dialog>
  );
}
