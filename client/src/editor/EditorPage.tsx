import type { OpenedDocument } from "@docs/shared";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { api, ApiError } from "../api.ts";
import { DocumentEditor } from "./DocumentEditor.tsx";

/** Loads the document; reloading (after a restore) remounts the editor with the new version. */
export function EditorPage() {
  const { id = "" } = useParams();
  const [loaded, setLoaded] = useState<{ document: OpenedDocument; generation: number } | null>(null);
  const [error, setError] = useState<{ notFound: boolean; message: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const document = await api.openDocument(id);
      setLoaded((previous) => ({ document, generation: (previous?.generation ?? 0) + 1 }));
      setError(null);
    } catch (loadError) {
      setError({
        notFound: loadError instanceof ApiError && loadError.status === 404,
        message: (loadError as Error).message,
      });
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
      </div>
    );
  }
  if (!loaded) return <div className="page-message">Loading…</div>;

  return <DocumentEditor key={`${id}:${loaded.generation}`} document={loaded.document} onReload={load} />;
}
