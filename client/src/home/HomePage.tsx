import type { DocumentSort, DocumentSummary, DocumentTemplate, ImportResponse } from "@docs/shared";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../api.ts";
import { ConfirmDialog } from "../components/ConfirmDialog.tsx";
import { lazyComponent } from "../components/lazyComponent.tsx";
import type { MenuEntry } from "../components/Menu.tsx";
import { PromptDialog } from "../components/PromptDialog.tsx";
import { HomeHeader } from "./HomeHeader.tsx";
import { RecentDocuments, sortLabels, type DocumentView, type OwnerFilter } from "./RecentDocuments.tsx";
import { TemplatesBand } from "./TemplatesBand.tsx";
import { useStoredSetting } from "./useStoredSetting.ts";

const ImportDialog = lazyComponent(() => import("./ImportDialog.tsx").then((module) => module.ImportDialog));

const VIEW_SETTING = "docs.home.view";
const SORT_SETTING = "docs.home.sort";
const OWNER_SETTING = "docs.home.owner";
const TEMPLATES_SETTING = "docs.home.templates";

/** Shown in the editor after importing, when some content could not be converted. */
export type ImportNotice = { importNotice: string };

export function HomePage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [view, setView] = useStoredSetting<DocumentView>(VIEW_SETTING, "grid", ["grid", "list"]);
  const [sort, setSort] = useStoredSetting<DocumentSort>(SORT_SETTING, "lastOpened", Object.keys(sortLabels) as DocumentSort[]);
  // There is one user, so both choices show every document.
  const [owner, setOwner] = useStoredSetting<OwnerFilter>(OWNER_SETTING, "anyone", ["anyone", "me"]);
  const [templates, setTemplates] = useStoredSetting(TEMPLATES_SETTING, "shown", ["shown", "hidden"]);
  const [documents, setDocuments] = useState<DocumentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<DocumentSummary | null>(null);
  const [removing, setRemoving] = useState<DocumentSummary | null>(null);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    try {
      setDocuments(await api.listDocuments({ query, sort }));
      setError(null);
    } catch (loadError) {
      setError((loadError as Error).message);
    }
  }, [query, sort]);

  useEffect(() => {
    document.title = "Docs";
    const timer = setTimeout(load, query ? 200 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  async function create(template?: DocumentTemplate) {
    const created = await api.createDocument({ template: template?.id });
    navigate(`/d/${created.id}`);
  }

  async function remove(doc: DocumentSummary) {
    setRemoving(null);
    await api.deleteDocument(doc.id);
    await load();
  }

  async function rename(doc: DocumentSummary, title: string) {
    setRenaming(null);
    await api.renameDocument(doc.id, title);
    await load();
  }

  function opened({ document, dropped }: ImportResponse) {
    const state: ImportNotice | undefined =
      dropped.length > 0 ? { importNotice: `Some content could not be converted exactly: ${dropped.join(", ")}.` } : undefined;
    navigate(`/d/${document.id}`, { state });
  }

  const actions = (doc: DocumentSummary): MenuEntry[] => [
    { label: "Rename", icon: "edit", onSelect: () => setRenaming(doc) },
    { label: "Remove", icon: "delete", onSelect: () => setRemoving(doc) },
    { label: "Open in new tab", icon: "open_in_new", onSelect: () => window.open(`/d/${doc.id}`, "_blank") },
  ];

  return (
    <div className="home">
      <HomeHeader
        query={query}
        onQueryChange={setQuery}
        templatesShown={templates === "shown"}
        onTemplatesShownChange={(shown) => setTemplates(shown ? "shown" : "hidden")}
      />

      {templates === "shown" && <TemplatesBand onCreate={(template) => void create(template)} onHide={() => setTemplates("hidden")} />}

      <main className="home-column recent-documents">
        <RecentDocuments
          documents={documents ?? []}
          title={query ? "Search results" : "Recent documents"}
          view={view}
          sort={sort}
          owner={owner}
          onViewChange={setView}
          onSortChange={setSort}
          onOwnerChange={setOwner}
          onOpenFilePicker={() => setImporting(true)}
          onPreloadFilePicker={() => void ImportDialog.preload()}
          actions={actions}
        >
          {error && <p className="error">Couldn't load documents: {error}</p>}
          {documents?.length === 0 && (
            <p className="empty">              {query
                ? `No documents match "${query}".`
                : `No documents yet.${templates === "shown" ? " Start a blank document above." : ""}`}</p>
          )}
        </RecentDocuments>
      </main>

      {renaming && (
        <PromptDialog
          title="Rename"
          label="Document name"
          initialValue={renaming.title}
          onConfirm={(title) => void rename(renaming, title)}
          onCancel={() => setRenaming(null)}
        />
      )}

      {removing && (
        <ConfirmDialog
          title="Remove document?"
          message={`"${removing.title}" will be deleted permanently.`}
          confirmLabel="Remove"
          onConfirm={() => void remove(removing)}
          onCancel={() => setRemoving(null)}
        />
      )}

      {importing && <ImportDialog onImported={opened} onClose={() => setImporting(false)} />}
    </div>
  );
}
