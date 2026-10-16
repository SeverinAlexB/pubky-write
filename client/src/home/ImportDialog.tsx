import type { ImportResponse } from "@pubky-write/shared";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { api } from "../api.ts";
import { Icon } from "../components/Icon.tsx";

const MAX_BYTES = 20 * 1024 * 1024;
const ACCEPTED = /\.(docx|md|markdown)$/i;

type ImportDialogProps = {
  onImported: (result: ImportResponse) => void;
  onClose: () => void;
};

/** "Open a file": uploads a Word or Markdown file, which the server converts into a new document. */
export function ImportDialog({ onImported, onClose }: ImportDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  async function upload(file: File | undefined) {
    if (!file || uploading) return;
    if (!ACCEPTED.test(file.name)) return setError("Choose a Word (.docx) or Markdown (.md) file.");
    if (file.size > MAX_BYTES) return setError("Files can be at most 20 MB.");
    setError(null);
    setUploading(file.name);
    try {
      onImported(await api.importDocument(file));
    } catch (uploadError) {
      setError(`Couldn't open "${file.name}": ${(uploadError as Error).message}`);
      setUploading(null);
    }
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void upload(event.dataTransfer.files[0]);
  };

  return (
    <dialog ref={dialog} className="dialog import-dialog" aria-labelledby="import-dialog-title" onCancel={onClose}>
      <div className="import-dialog-header">
        <h2 id="import-dialog-title">Open a file</h2>
        <button type="button" className="icon-button" aria-label="Close" data-tooltip="Close" onClick={onClose}>
          <Icon name="close" size={24} />
        </button>
      </div>
      <div role="tablist" aria-label="Open a file from" className="import-tabs">
        <button type="button" role="tab" id="import-upload-tab" aria-selected="true" aria-controls="import-upload-panel" className="import-tab">
          Upload
        </button>
      </div>
      <div
        role="tabpanel"
        id="import-upload-panel"
        aria-labelledby="import-upload-tab"
        className={`import-drop-zone${dragging ? " is-dragging" : ""}`}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={onDrop}
      >
        {uploading ? (
          <p role="status" className="import-status">
            <Icon name="sync" size={24} className="spin" />
            Opening {uploading}…
          </p>
        ) : (
          <>
            <Icon name="upload_file" size={48} className="import-drop-icon" />
            <p className="import-drop-text">Drag a file here</p>
            <p className="import-drop-or">or</p>
            <button type="button" className="button-primary" onClick={() => input.current?.click()}>
              Browse
            </button>
            <p className="import-drop-hint">Word (.docx) and Markdown (.md) files up to 20 MB</p>
          </>
        )}
        <input
          ref={input}
          type="file"
          accept=".docx,.md,.markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown"
          hidden
          aria-label="Choose a file"
          onChange={(event) => void upload(event.target.files?.[0])}
        />
        {error && (
          <p role="alert" className="dialog-error">
            {error}
          </p>
        )}
      </div>
    </dialog>
  );
}
