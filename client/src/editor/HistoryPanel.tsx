import type { Revision, RevisionWithContent } from "@docs/shared";
import { documentExtensions } from "@docs/shared";
import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { Icon } from "../components/Icon.tsx";
import { formatDateTime } from "../format.ts";

type HistoryPanelProps = {
  documentId: string;
  selected: RevisionWithContent | null;
  onSelect: (revision: RevisionWithContent | null) => void;
  onRestore: (revision: Revision) => void;
  onClose: () => void;
};

/** Lists editing sessions, newest first. Selecting one previews it in place of the editor. */
export function HistoryPanel({ documentId, selected, onSelect, onRestore, onClose }: HistoryPanelProps) {
  const [revisions, setRevisions] = useState<Revision[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listRevisions(documentId).then(setRevisions, (loadError: Error) => setError(loadError.message));
  }, [documentId]);

  async function select(revision: Revision) {
    onSelect(await api.getRevision(documentId, revision.id));
  }

  const current = revisions?.[0];

  return (
    <aside className="history-panel" aria-label="Version history">
      <div className="history-header">
        <h2>Version history</h2>
        <button type="button" className="icon-button" aria-label="Close version history" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      {error && <p className="error">Couldn't load history: {error}</p>}
      {revisions?.length === 0 && <p className="empty">No edits yet.</p>}
      <ol className="revision-list">
        {revisions?.map((revision) => (
          <li key={revision.id}>
            <button
              type="button"
              className={`revision${selected?.id === revision.id ? " is-selected" : ""}`}
              aria-current={selected?.id === revision.id}
              onClick={() => void select(revision)}
            >
              <span className="revision-date">{formatDateTime(revision.endedAt)}</span>
              {revision === current && <span className="revision-note">Current version</span>}
              {revision.restoredFrom !== null && <span className="revision-note">Restored version</span>}
            </button>
          </li>
        ))}
      </ol>
      {selected && current && selected.id !== current.id && (
        <div className="history-footer">
          <button type="button" className="button-primary" onClick={() => onRestore(selected)}>
            Restore this version
          </button>
        </div>
      )}
    </aside>
  );
}

/** Read-only rendering of a revision. */
export function RevisionPreview({ revision }: { revision: RevisionWithContent }) {
  const editor = useEditor(
    {
      extensions: documentExtensions,
      content: revision.content,
      editable: false,
      editorProps: { attributes: { class: "page-content", "aria-label": "Version preview" } },
    },
    [revision.id],
  );
  return <EditorContent editor={editor} />;
}
