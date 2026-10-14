import type { OpenedDocument } from "@docs/shared";
import { useCallback, useEffect, useState, type ComponentType } from "react";
import { Link, useParams } from "react-router";
import { api, ApiError } from "../api.ts";
import { lazyComponent } from "../components/lazyComponent.tsx";
import type { PendingEntry } from "./pendingSteps.ts";

const UnsavedChangesDialog = lazyComponent(() => import("./UnsavedChangesDialog.tsx").then((module) => module.UnsavedChangesDialog));

type DocumentEditorComponent = ComponentType<{ document: OpenedDocument; onReload: () => Promise<void> }>;

// The editor's code is loaded together with the document, so the document list does not load it.
// It is rendered once both are there rather than through Suspense, which would hold back
// showing it for a moment after the loading message.
const loadEditor = (): Promise<DocumentEditorComponent> => import("./DocumentEditor.tsx").then((module) => module.DocumentEditor);

/** Loads the document; reloading (after a restore) remounts the editor with the new version. */
export function EditorPage() {
  const { id = "" } = useParams();
  const [loaded, setLoaded] = useState<{
    document: OpenedDocument;
    DocumentEditor: DocumentEditorComponent;
    generation: number;
  } | null>(null);
  const [error, setError] = useState<{ notFound: boolean; message: string } | null>(null);
  // Edits kept in this browser for a document that no longer exists.
  const [orphaned, setOrphaned] = useState<PendingEntry[]>([]);

  const load = useCallback(async () => {
    try {
      const [document, DocumentEditor] = await Promise.all([api.openDocument(id), loadEditor()]);
      setLoaded((previous) => ({ document, DocumentEditor, generation: (previous?.generation ?? 0) + 1 }));
      setError(null);
    } catch (loadError) {
      const notFound = loadError instanceof ApiError && loadError.status === 404;
      setError({ notFound, message: (loadError as Error).message });
      if (notFound) {
        const { pendingStore } = await import("./pendingSteps.ts");
        setOrphaned(await pendingStore.list(id).catch(() => []));
      }
    }
  }, [id]);

  useEffect(() => {
    setLoaded(null);
    void load();
  }, [load]);

  if (error) {
    return (
      <div className="page-message">
        <h1>{error.notFound ? "Document not found" : "Couldn't open the document"}</h1>
        {!error.notFound && <p>{error.message}</p>}
        <Link to="/">Back to Docs</Link>
        {orphaned.length > 0 && (
          <UnsavedChangesDialog entries={orphaned} documentTitle="Deleted document" deleted onClose={() => setOrphaned([])} />
        )}
      </div>
    );
  }
  if (!loaded) return <div className="page-message">Loading…</div>;

  const { DocumentEditor } = loaded;
  return <DocumentEditor key={`${id}:${loaded.generation}`} document={loaded.document} onReload={load} />;
}
