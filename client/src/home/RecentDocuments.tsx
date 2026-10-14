import type { DocumentSort, DocumentSummary } from "@docs/shared";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Icon } from "../components/Icon.tsx";
import { Menu, type MenuEntry } from "../components/Menu.tsx";
import { dateGroup, formatListDate, type DateGroup } from "../format.ts";
import { DocumentThumbnail } from "./DocumentThumbnail.tsx";

export type DocumentView = "grid" | "list";
export type OwnerFilter = "anyone" | "me";

export const sortLabels: Record<DocumentSort, string> = {
  lastOpened: "Last opened by me",
  lastModifiedByMe: "Last modified by me",
  lastModified: "Last modified",
  title: "Title",
};

const ownerLabels: Record<OwnerFilter, string> = { anyone: "Owned by anyone", me: "Owned by me" };

const THUMBNAIL_WIDTH = 208;

const isModifiedSort = (sort: DocumentSort) => sort === "lastModified" || sort === "lastModifiedByMe";

/** The date a document is shown and grouped by: when it was modified for the modified sorts, otherwise opened. */
const dateOf = (doc: DocumentSummary, sort: DocumentSort) => (isModifiedSort(sort) ? doc.updatedAt : doc.lastOpenedAt);

type RecentDocumentsProps = {
  documents: DocumentSummary[];
  title: string;
  view: DocumentView;
  sort: DocumentSort;
  owner: OwnerFilter;
  onViewChange: (view: DocumentView) => void;
  onSortChange: (sort: DocumentSort) => void;
  onOwnerChange: (owner: OwnerFilter) => void;
  onOpenFilePicker: () => void;
  onPreloadFilePicker: () => void;
  /** The ⋮ menu of a tile or row. */
  actions: (doc: DocumentSummary) => MenuEntry[];
  /** Shown between the header row and the documents, such as an error or the empty state. */
  children?: ReactNode;
};

/** The header row with its controls, then the documents as tiles or as rows grouped by date. */
export function RecentDocuments(props: RecentDocumentsProps) {
  const { documents, view, sort, actions } = props;
  const groups = view === "list" ? groupByDate(documents, sort) : [];
  // In the list view the first date heading takes the title's place in the header row.
  const title = groups[0]?.heading ?? props.title;

  return (
    <>
      <div className={`recent-header recent-header-${view}`}>
        <h2>{title}</h2>
        <OwnerMenu owner={props.owner} onChange={props.onOwnerChange} />
        {view === "list" && <span className="recent-date-label">{isModifiedSort(sort) ? sortLabels[sort] : sortLabels.lastOpened}</span>}
        <div className="recent-controls">
          <button
            type="button"
            className="icon-button"
            aria-label={view === "grid" ? "List view" : "Grid view"}
            data-tooltip={view === "grid" ? "List view" : "Grid view"}
            onClick={() => props.onViewChange(view === "grid" ? "list" : "grid")}
          >
            <Icon name={view === "grid" ? "view_list" : "grid_view"} size={24} />
          </button>
          <Menu
            label={<Icon name="sort_by_alpha" size={24} />}
            buttonClassName="icon-button"
            ariaLabel="Sort options"
            align="end"
            entries={(Object.keys(sortLabels) as DocumentSort[]).map((value) => ({
              label: sortLabels[value],
              checked: value === sort,
              onSelect: () => props.onSortChange(value),
            }))}
          />
          <button
            type="button"
            className="icon-button"
            aria-label="Open file picker"
            data-tooltip="Open file picker"
            onMouseEnter={props.onPreloadFilePicker}
            onFocus={props.onPreloadFilePicker}
            onClick={props.onOpenFilePicker}
          >
            <Icon name="folder_open" size={24} />
          </button>
        </div>
      </div>

      {props.children}

      {view === "grid" ? (
        <ul className="document-grid" aria-label="Documents">
          {documents.map((doc) => (
            <DocumentTile key={doc.id} doc={doc} sort={sort} actions={actions(doc)} />
          ))}
        </ul>
      ) : (
        <div className="document-groups" role="group" aria-label="Documents">
          {groups.map((group, index) => (
            <div key={group.heading ?? "all"} className="document-group">
              {index > 0 && group.heading && <h3 className="document-group-heading">{group.heading}</h3>}
              <ul className="document-rows" aria-label={group.heading ?? "Documents"}>
                {group.documents.map((doc) => (
                  <DocumentRow key={doc.id} doc={doc} sort={sort} actions={actions(doc)} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function OwnerMenu({ owner, onChange }: { owner: OwnerFilter; onChange: (owner: OwnerFilter) => void }) {
  return (
    <div className="owner-menu">
      <Menu
        label={
          <>
            {ownerLabels[owner]}
            <Icon name="arrow_drop_down" size={20} />
          </>
        }
        buttonClassName="owner-button"
        entries={(Object.keys(ownerLabels) as OwnerFilter[]).map((value) => ({
          label: ownerLabels[value],
          checked: value === owner,
          onSelect: () => onChange(value),
        }))}
      />
    </div>
  );
}

/** Documents under date headings, newest first; sorted by title they stay one list without headings. */
function groupByDate(documents: DocumentSummary[], sort: DocumentSort): { heading: DateGroup | null; documents: DocumentSummary[] }[] {
  if (sort === "title") return documents.length > 0 ? [{ heading: null, documents }] : [];
  const groups: { heading: DateGroup; documents: DocumentSummary[] }[] = [];
  const now = new Date();
  for (const doc of documents) {
    const heading = dateGroup(dateOf(doc, sort), now);
    const last = groups[groups.length - 1];
    if (last?.heading === heading) last.documents.push(doc);
    else groups.push({ heading, documents: [doc] });
  }
  return groups;
}

type DocumentItemProps = { doc: DocumentSummary; sort: DocumentSort; actions: MenuEntry[] };

function ActionsMenu({ doc, actions }: { doc: DocumentSummary; actions: MenuEntry[] }) {
  return <Menu label={<Icon name="more_vert" />} buttonClassName="icon-button" ariaLabel={`More actions for ${doc.title}`} align="end" entries={actions} />;
}

function DocumentTile({ doc, sort, actions }: DocumentItemProps) {
  const date = `${isModifiedSort(sort) ? "Modified" : "Opened"} ${formatListDate(dateOf(doc, sort))}`;
  return (
    <li className="document-tile">
      <Link to={`/d/${doc.id}`} className="document-tile-link">
        <DocumentThumbnail document={doc} width={THUMBNAIL_WIDTH} />
        <span className="document-tile-footer">
          <span className="document-tile-title">{doc.title}</span>
          <span className="document-tile-date">
            <Icon name="description" size={16} className="document-icon" />
            {date}
          </span>
        </span>
      </Link>
      <div className="document-tile-actions">
        <ActionsMenu doc={doc} actions={actions} />
      </div>
    </li>
  );
}

function DocumentRow({ doc, sort, actions }: DocumentItemProps) {
  return (
    <li className="document-row">
      <Link to={`/d/${doc.id}`} className="document-row-link">
        <span className="document-row-title">
          <Icon name="description" size={20} className="document-icon" />
          <span>{doc.title}</span>
        </span>
        <span className="document-row-owner">me</span>
        <span className="document-row-date">{formatListDate(dateOf(doc, sort))}</span>
      </Link>
      <div className="document-row-actions">
        <ActionsMenu doc={doc} actions={actions} />
      </div>
    </li>
  );
}
