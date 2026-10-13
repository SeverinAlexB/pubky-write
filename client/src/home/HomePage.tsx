import type { DocumentSort, DocumentSummary } from "@docs/shared";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../api.ts";
import { Icon } from "../components/Icon.tsx";
import { Menu } from "../components/Menu.tsx";
import { PromptDialog } from "../components/PromptDialog.tsx";
import { formatShortDate } from "../format.ts";

const sortLabels: Record<DocumentSort, string> = {
  lastOpened: "Last opened by me",
  lastModified: "Last modified",
  title: "Title",
};

export function HomePage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<DocumentSort>("lastOpened");
  const [documents, setDocuments] = useState<DocumentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<DocumentSummary | null>(null);

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

  async function createBlank() {
    const created = await api.createDocument();
    navigate(`/d/${created.id}`);
  }

  async function remove(doc: DocumentSummary) {
    if (!confirm(`Delete "${doc.title}"? This can't be undone.`)) return;
    await api.deleteDocument(doc.id);
    await load();
  }

  async function rename(doc: DocumentSummary, title: string) {
    setRenaming(null);
    await api.renameDocument(doc.id, title);
    await load();
  }

  const dateFor = (doc: DocumentSummary) => (sort === "lastModified" ? doc.updatedAt : doc.lastOpenedAt);

  return (
    <div className="home">
      <header className="home-header">
        <Link to="/" className="brand">
          <img src="/favicon.svg" alt="" width={24} height={32} />
          <span>Docs</span>
        </Link>
        <div className="search" role="search">
          <Icon name="search" />
          <input
            type="search"
            placeholder="Search"
            aria-label="Search documents"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button type="button" className="icon-button" aria-label="Clear search" onClick={() => setQuery("")}>
              <Icon name="close" />
            </button>
          )}
        </div>
      </header>

      <section className="templates" aria-labelledby="start-heading">
        <div className="home-width">
          <h2 id="start-heading">Start a new document</h2>
          <button type="button" className="template-card" onClick={createBlank}>
            <span className="template-preview">
              <Icon name="add" size={48} />
            </span>
            <span className="template-name">Blank document</span>
          </button>
        </div>
      </section>

      <main className="home-width">
        <div className="list-header">
          <h2>{query ? "Search results" : "Recent documents"}</h2>
          <label className="sort">
            <span>Sort by</span>
            <select value={sort} onChange={(event) => setSort(event.target.value as DocumentSort)}>
              {Object.entries(sortLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error && <p className="error">Couldn't load documents: {error}</p>}
        {documents?.length === 0 && (
          <p className="empty">{query ? `No documents match "${query}".` : "No documents yet. Start a blank document above."}</p>
        )}

        <ul className="document-list" aria-label="Documents">
          {documents?.map((doc) => (
            <li key={doc.id} className="document-row">
              <Link to={`/d/${doc.id}`} className="document-link">
                <Icon name="description" className="document-icon" />
                <span className="document-title">{doc.title}</span>
                <span className="document-date">{formatShortDate(dateFor(doc))}</span>
              </Link>
              <Menu
                label={<Icon name="more_vert" />}
                buttonClassName="icon-button"
                ariaLabel={`More actions for ${doc.title}`}
                align="end"
                entries={[
                  { label: "Rename", icon: "edit", onSelect: () => setRenaming(doc) },
                  { label: "Remove", icon: "delete", onSelect: () => void remove(doc) },
                  {
                    label: "Open in new tab",
                    icon: "open_in_new",
                    onSelect: () => window.open(`/d/${doc.id}`, "_blank"),
                  },
                ]}
              />
            </li>
          ))}
        </ul>
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
    </div>
  );
}
