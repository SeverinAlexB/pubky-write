// Version history mode: a top bar in place of the header and toolbar, the selected version as
// read-only pages in the centre and the list of versions on the right (docs/spec/08-version-history.md).
import {
  documentExtensions,
  documentSchema,
  emptyDocument,
  pageGeometry,
  pageSetupOf,
  versionEdits,
  type Revision,
} from "@docs/shared";
import { Node } from "@tiptap/pm/model";
import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.ts";
import { ConfirmDialog } from "../components/ConfirmDialog.tsx";
import { Icon } from "../components/Icon.tsx";
import { Menu } from "../components/Menu.tsx";
import { PromptDialog } from "../components/PromptDialog.tsx";
import { formatDay, formatVersionTime, formatVersionTitle } from "../format.ts";
import { PageElements } from "./PageElements.tsx";
import { useFitZoom, usePrintPageRule } from "./pageView.ts";
import { Pagination, resetPagination } from "./pagination.ts";
import { ToolButton } from "./toolbar/ToolButton.tsx";
import { ZoomControl, type Zoom } from "./toolbar/ZoomControl.tsx";
import { VersionHighlight } from "./versionHighlight.ts";

type HistoryModeProps = {
  documentId: string;
  /** Saves pending edits, then lists the versions, newest first. */
  loadRevisions: () => Promise<Revision[]>;
  initialZoom: Zoom;
  onBack: () => void;
  onRestore: (revision: Revision) => Promise<void>;
  onMakeCopy: (revision: Revision) => Promise<void>;
};

type Filter = "all" | "named";

/** The shown version and the one before it, which its changes are highlighted against. */
type Comparison = { id: number; before: Node; after: Node };

const emptyDoc = Node.fromJSON(documentSchema, emptyDocument);

export function HistoryMode({ documentId, loadRevisions, initialZoom, onBack, onRestore, onMakeCopy }: HistoryModeProps) {
  const [revisions, setRevisions] = useState<Revision[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [highlight, setHighlight] = useState(true);
  const [zoom, setZoom] = useState<Zoom>(initialZoom);
  const [currentEdit, setCurrentEdit] = useState<number | null>(null);
  const [restoring, setRestoring] = useState<Revision | null>(null);
  const [naming, setNaming] = useState<Revision | null>(null);
  const contents = useRef(new Map<number, Promise<Node>>());

  useEffect(() => {
    loadRevisions().then(
      (list) => {
        setRevisions(list);
        setSelectedId(list[0]?.id ?? null);
      },
      (loadError: Error) => setError(loadError.message),
    );
  }, []);

  const shown = useMemo(
    () => (filter === "named" ? (revisions ?? []).filter((revision) => revision.name !== null) : (revisions ?? [])),
    [revisions, filter],
  );
  const selectedIndex = shown.findIndex((revision) => revision.id === selectedId);
  const selected = shown[selectedIndex];
  // Changes are shown against the version below in the list; the oldest against an empty document.
  const previous = selected ? shown[selectedIndex + 1] : undefined;

  // Switching to Named versions selects the newest named version if the selected one is not named.
  useEffect(() => {
    if (revisions && !selected) setSelectedId(shown[0]?.id ?? null);
  }, [revisions, selected, shown]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    Promise.all([revisionContent(selected.id), previous ? revisionContent(previous.id) : emptyDoc]).then(
      ([after, before]) => {
        if (!cancelled) setComparison({ id: selected.id, before, after });
      },
      (loadError: Error) => setError(loadError.message),
    );
    return () => {
      cancelled = true;
    };
  }, [selected?.id, previous?.id]);

  function revisionContent(revisionId: number): Promise<Node> {
    let content = contents.current.get(revisionId);
    if (!content) {
      content = api.getRevision(documentId, revisionId).then((revision) => Node.fromJSON(documentSchema, revision.content));
      contents.current.set(revisionId, content);
    }
    return content;
  }

  const edits = useMemo(() => (comparison ? versionEdits(comparison.before, comparison.after) : []), [comparison]);
  useEffect(() => setCurrentEdit(null), [edits, highlight]);

  const preview = useEditor(
    {
      extensions: [...documentExtensions, Pagination, VersionHighlight.configure({ edits: highlight ? edits : [] })],
      content: (comparison?.after ?? emptyDoc).toJSON(),
      editable: false,
      editorProps: { attributes: { class: "page-content", "aria-label": "Version preview" } },
    },
    [comparison, highlight, edits],
  );

  const pageSetup = useMemo(() => pageSetupOf(comparison?.after ?? emptyDoc), [comparison]);
  const geometry = useMemo(() => pageGeometry(pageSetup), [pageSetup]);
  usePrintPageRule(pageSetup);
  const fit = useFitZoom(geometry.width, 0);
  const effectiveZoom = zoom === "fit" ? fit.value : zoom;

  useEffect(() => {
    if (!preview.isDestroyed) resetPagination(preview.view);
  }, [preview, effectiveZoom]);

  /** Scrolls edit `index` to the middle of the preview and marks it as the current edit. */
  function goToEdit(index: number) {
    const edit = edits[index];
    if (!edit || !fit.element) return;
    setCurrentEdit(index);
    for (const element of fit.element.querySelectorAll(".is-current-edit")) element.classList.remove("is-current-edit");
    const marked = fit.element.querySelectorAll<HTMLElement>(`[data-edit="${index}"]`);
    for (const element of marked) element.classList.add("is-current-edit");
    // An edit without text of its own (such as a split paragraph) scrolls to where it is.
    const { node } = preview.view.domAtPos(edit.from);
    const target = marked[0] ?? (node instanceof HTMLElement ? node : node.parentElement);
    target?.scrollIntoView({ block: "center" });
  }

  async function nameVersion(revision: Revision, name: string) {
    setNaming(null);
    const named = await api.nameRevision(documentId, revision.id, name);
    setRevisions((current) => current?.map((candidate) => (candidate.id === named.id ? named : candidate)) ?? null);
  }

  const newestId = revisions?.[0]?.id;
  const editCount = edits.length;

  return (
    <div className="history-mode">
      <div className="history-main">
        <header className="history-top-bar">
          <button type="button" className="icon-button" aria-label="Back" data-tooltip="Back" onClick={onBack}>
            <Icon name="arrow_back" size={24} />
          </button>
          <h1 className="history-title">{selected ? (selected.name ?? formatVersionTitle(selected.endedAt)) : "Version history"}</h1>
        </header>
        <div className="history-toolbar" role="toolbar" aria-label="Version history toolbar">
          <ToolButton label="Print" onClick={() => window.print()}>
            <Icon name="print" />
          </ToolButton>
          <ZoomControl zoom={zoom} onChange={setZoom} />
          <span className="history-toolbar-spacer" />
          {highlight && comparison && (
            <>
              <span className="history-edit-count" aria-live="polite">
                Total: {editCount} {editCount === 1 ? "edit" : "edits"}
              </span>
              <button
                type="button"
                className="icon-button history-edit-button"
                aria-label="Previous edit"
                data-tooltip="Previous edit"
                disabled={currentEdit === null || currentEdit === 0}
                onClick={() => goToEdit((currentEdit ?? 0) - 1)}
              >
                <Icon name="keyboard_arrow_up" />
              </button>
              <button
                type="button"
                className="icon-button history-edit-button"
                aria-label="Next edit"
                data-tooltip="Next edit"
                disabled={currentEdit === editCount - 1 || editCount === 0}
                onClick={() => goToEdit(currentEdit === null ? 0 : currentEdit + 1)}
              >
                <Icon name="keyboard_arrow_down" />
              </button>
            </>
          )}
        </div>

        <div className="history-body">
          {/* Focusable, so the read-only preview can be scrolled with the keyboard. */}
          <div className="editor-scroll history-scroll" ref={fit.ref} tabIndex={0} role="region" aria-label="Selected version">
            <div className="page-column" hidden={!comparison}>
              <div className="page-stack" style={{ zoom: effectiveZoom }}>
                {/* One sheet per page, drawn by the pagination plugin. */}
                <div className="page-sheets" aria-hidden />
                <EditorContent editor={preview} />
                <PageElements editor={preview} target={null} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <aside className="history-panel" aria-label="Version history">
        <div className="history-panel-header">
          <h2>Version history</h2>
          {/* The panel's menu is P2. */}
          <button type="button" className="icon-button history-panel-menu" aria-label="Version history options" disabled>
            <Icon name="more_vert" />
          </button>
        </div>
        <div className="history-filter">
          <Menu
            label={
              <>
                <span>{filter === "all" ? "All versions" : "Named versions"}</span>
                <Icon name="arrow_drop_down" />
              </>
            }
            ariaLabel="Show versions"
            buttonClassName="history-filter-button"
            listClassName="history-filter-menu"
            entries={[
              { label: "All versions", checked: filter === "all", onSelect: () => setFilter("all") },
              { label: "Named versions", checked: filter === "named", onSelect: () => setFilter("named") },
            ]}
          />
        </div>
        {error && <p className="error">Couldn't load version history: {error}</p>}
        {revisions && shown.length === 0 && (
          <p className="empty">{filter === "named" ? "No named versions yet." : "No versions yet."}</p>
        )}
        <div className="history-versions">
          {groupByDay(shown).map(({ day, versions }) => (
            <section key={day} className="history-day" aria-label={day}>
              <h3>{day}</h3>
              <ol>
                {versions.map((revision) => (
                  <VersionEntry
                    key={revision.id}
                    revision={revision}
                    current={revision.id === newestId}
                    selected={revision.id === selected?.id}
                    onSelect={() => setSelectedId(revision.id)}
                    onRestore={() => setRestoring(revision)}
                    onName={() => setNaming(revision)}
                    onMakeCopy={() => void onMakeCopy(revision)}
                  />
                ))}
              </ol>
            </section>
          ))}
        </div>
        <label className="history-highlight">
          <input type="checkbox" checked={highlight} onChange={(event) => setHighlight(event.target.checked)} />
          Highlight changes
        </label>
      </aside>

      {restoring && (
        <ConfirmDialog
          title="Restore this version?"
          confirmLabel="Restore"
          onCancel={() => setRestoring(null)}
          onConfirm={() => {
            setRestoring(null);
            onRestore(restoring).catch((restoreError: Error) => setError(restoreError.message));
          }}
        />
      )}

      {naming && (
        <PromptDialog
          title="Name this version"
          label="Version name"
          initialValue={naming.name ?? ""}
          confirmLabel="Save"
          onConfirm={(name) => void nameVersion(naming, name)}
          onCancel={() => setNaming(null)}
        />
      )}
    </div>
  );
}

type VersionEntryProps = {
  revision: Revision;
  current: boolean;
  selected: boolean;
  onSelect: () => void;
  onRestore: () => void;
  onName: () => void;
  onMakeCopy: () => void;
};

function VersionEntry({ revision, current, selected, onSelect, onRestore, onName, onMakeCopy }: VersionEntryProps) {
  const time = formatVersionTime(revision.endedAt);
  return (
    <li className={`version-entry${selected ? " is-selected" : ""}`}>
      <button type="button" className="version-select" aria-current={selected} onClick={onSelect}>
        <span className="version-title">{revision.name ?? time}</span>
        {revision.name !== null && <span className="version-time">{time}</span>}
        {current && <span className="version-note">Current version</span>}
        {revision.restoredFrom !== null && <span className="version-note">Restored version</span>}
        <span className="version-author">
          <span className="version-author-dot" aria-hidden />
          You
        </span>
      </button>
      <Menu
        label={<Icon name="more_vert" />}
        ariaLabel="More actions"
        buttonClassName="icon-button version-menu-button"
        align="end"
        listClassName="version-menu"
        entries={[
          ...(current ? [] : [{ label: "Restore this version", onSelect: onRestore }]),
          { label: "Name this version", onSelect: onName },
          { label: "Make a copy", onSelect: onMakeCopy },
        ]}
      />
    </li>
  );
}

function groupByDay(revisions: Revision[]): { day: string; versions: Revision[] }[] {
  const groups: { day: string; versions: Revision[] }[] = [];
  for (const revision of revisions) {
    const day = formatDay(revision.endedAt);
    const group = groups.at(-1);
    if (group?.day === day) group.versions.push(revision);
    else groups.push({ day, versions: [revision] });
  }
  return groups;
}
