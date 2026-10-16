# Design: document tabs

Our own design for spec 18 (multiple tabs per document, amending 07).

## Data model

A document stays **one ProseMirror document**, so the step protocol, the offline store, undo,
comment anchors, suggestions and version history keep working unchanged. Its top node accepts
either form:

```
doc: block+ | documentTab+
documentTab: block+   (isolating)
```

| Attribute of `documentTab` | Meaning |
| --- | --- |
| `id` | Short id (`t.` + 8 random characters, or `t.0` for the first tab of an older document). Required (no default), so ProseMirror never creates a tab node by itself, for example to fit pasted blocks. |
| `name` | Shown in the sidebar, at most 100 characters, not blank. |
| `emoji` | Shown in place of the document icon, or `null`. |
| `parentId` | The tab it is nested under, or `null` at the top level. |
| `order` | Place in the sidebar (pre-order index). |
| `showOutline` | "Show outline": the outline is listed under the tab even when another tab is shown. |

The title, page setup, headers, footers and page numbering are attributes of the document node,
so they are shared by all tabs as the spec requires.

**Tab nodes never move.** The sidebar order and nesting are the `order` and `parentId`
attributes; Move up, Move down and Move into only change attributes (`AttrStep`s). Moving content
would be a delete and an insert, which collapses every comment anchor in the moved text (anchors
are positions, mapped through steps on the server and in the editor). New tabs (Add tab, Add
subtab, Duplicate) are inserted at the end of the document and placed in the sidebar by their
attributes. `tabTree(doc)` (in `shared/src/documentTabs.ts`) turns the attributes into the
sidebar's tree; a missing parent, a cycle or nesting deeper than three levels puts a tab at the
top level, so a damaged document still shows every tab.

`documentTab` is `isolating`, so Backspace at the start of a tab and Delete at its end never join
two tabs. The editor additionally never lets the selection cross a tab boundary (below).

## Documents from before tabs (compatibility)

Nothing is migrated. A document whose content is blocks is read everywhere as **one tab**,
"Tab 1" with id `t.0`, covering the whole content (`documentTabs(doc)` returns a virtual tab with
`pos: null`). Stored documents, stored steps, versions and comment anchors stay valid as they are.

The first command that needs tab nodes (Add tab, Rename, Choose emoji, …) begins with
`wrapInTab`: one `ReplaceAroundStep` that wraps all content in a tab node with id `t.0`, in the same
transaction (and undo step) as the command. It is an ordinary step, so

- the server validates and stores it like any other, and moves comment anchors by one;
- edits kept offline from before it are rebased over it like over any other step;
- undoing the command unwraps the document again.

Readers that compare versions treat an older version without tab nodes as its tab `t.0`:
`versionEdits` matches tabs by id (so wrapping shows no edits), and `replaceDifference` (restore)
wraps the older version first and then compares tab by tab. New documents, templates and imports
are still created as blocks ("Import creates a single tab").

## The editor

`client/src/editor/documentTabs.ts` is a Tiptap extension with priority 1000, so its plugin state
is computed before the plugins that read it (search, pagination).

- **Shown tab.** Plugin state `{ currentId }`, from `?tab=<id>` at load or the first tab in the
  sidebar. A transaction switches with the meta `setCurrentTab(tr, id)`. When the shown tab is
  deleted (or an undo removes it), the tab with the selection is shown.
- **Hiding.** Every other tab gets a node decoration with class `is-hidden-tab`
  (`display: none`). Hidden tabs are in the DOM but neither laid out nor printed. A document
  without tab nodes gets no decorations, so the common single-tab case costs nothing.
- **Selection.** An `appendTransaction` keeps the selection inside the shown tab's content:
  select all selects the tab's content, a cursor moved past the tab's edge (arrow keys, `focus("start")`)
  is put back. Searching for a valid position goes towards the inside of the tab, so it never
  lands in the next one.
- **Undo and redo** are per tab (spec 18, round 5; `tabHistory.ts`, below). An undo of a
  document-wide change can still change another tab (undoing Delete brings a tab back): the same
  `appendTransaction` finds the first position an undo or redo changed (from its step maps) and
  shows that tab with the cursor there. Tab commands are their own undo steps (closed before and
  after).
- **Clipboard.** Copied content carries its tab as context; `transformPasted` unwraps tab nodes,
  so pasting never creates a tab.

What reads "the document" now reads the shown tab (`currentTab(state)`, with `from`/`to` of its
content and its node):

| Feature | Scope |
| --- | --- |
| Pagination (`boxNodes`), page and footnote numbers, tab-character layout | shown tab |
| Footnotes (`documentFootnotes(state)`, numbered per tab) | shown tab |
| Find and replace | shown tab (recomputed on switching) |
| Word count, live word count | shown tab (the selection count is unchanged) |
| Outline | each listed tab's own headings |
| Table of contents (insert, update, page numbers, links) | the headings of the tab it is in |
| Comment margin, review suggested edits, Accept/Reject all | shown tab |
| All comments | every thread, with its tab's name when there are several tabs |
| Print / PDF | shown tab (the others are not displayed) |

## Sidebar

`OutlinePanel.tsx` lists `tabTree(doc)`: rows indented 16px per level, a chevron on parents
(collapsing is view state, not saved), the emoji or document icon, the name (a button that shows
the tab), the open-comment badge (threads whose anchor is in the tab) and the ⋮ Tab options menu
(visible on hover, focus, for the current tab and while open). The shown tab's outline is listed
under it, and other tabs' outlines when Show outline is on.

The commands are pure functions of the state returning one transaction (`addTab`, `addSubtab`,
`deleteTab`, `duplicateTab`, `setTabAttribute`, `moveTab`, `moveTabInto`, `switchTab`), tested in
`documentTabs.test.ts`. `DocumentEditor` runs them, remembering for the tab being left its
selection (as offsets in the tab) and scroll position for the session, and restoring them when the
tab is shown again; a new tab starts at its top with the cursor at its start.

Duplicate copies the tab's content (not its subtabs) as "Copy of <name>" right after the tab and
its subtabs, with new suggestion ids (one suggestion's parts share an id; the copy's must stay a
separate suggestion). Comments are not copied (their anchors stay on the original).

## Exports, thumbnails, version history

- `tabsDocument(doc, id | "all")` makes a document of blocks from one tab, or from all tabs in
  sidebar order with a page break before each tab after the first and the tab's name as a
  Heading 1. The page setup and headers are kept. `GET /api/documents/:id/export/:format?tab=`
  takes a tab id or `all` (without it, the first tab). File > Download lists the formats under
  "Current tab" and "All tabs" (no PDF: printing prints the shown tab) once a document has
  several tabs. Plain text is made in the browser the same way.
- The thumbnail (`server/src/preview.ts`) is the top of the first tab in the sidebar.
- The version preview has the same tab sidebar (read-only: no + and no ⋮) when the version has
  several tabs, starting on the tab the editor shows. Previous edit / Next edit switch to the tab
  of the edit. Highlighted edits are computed per tab (`versionEdits`), so "Total: N edits"
  counts all tabs.

## Known limits

- Find has no "All tabs" option yet (P2), and drag and drop in the sidebar is not built (P2).
- A comment whose tab was deleted keeps its thread (as for deleted text) but is in no tab: it is
  listed in All comments without a tab name and not shown in any margin.
- Moving tabs changes the sidebar order only; the order of tabs in the stored document (and so in
  search results' text and the plain text the server searches) stays the order they were created.

## Undo per tab

`client/src/editor/tabHistory.ts` replaces Tiptap's UndoRedo (prosemirror-history) with a
history that has one timeline per tab and a shared one.

- **Timelines.** Each recorded transaction goes to the timeline of the tab all its steps change
  (`timelineOf`: the tab whose content holds the step's range). Document attribute steps (page
  setup, columns, headers and footers, page numbering), attribute steps on tab nodes (rename,
  emoji, Show outline, move), inserting or deleting tab nodes (add, duplicate, delete), wrapping a
  document in its first tab, and transactions that change several tabs go to the shared timeline.
  A document without tab nodes has one tab, `t.0`.
- **Undo and redo** take the latest event of the shown tab's timeline together with the shared one
  (`done` and `undone` are single lists ordered by a sequence number, filtered by timeline). So
  edits in other tabs stay, and a document-wide change is undone when it is the latest change seen
  from the shown tab. A new change ends what could be redone in its timeline (a shared change: in
  all of them).
- **Mapping.** An event keeps its steps' maps and inverses, and the history keeps a log of every
  change's maps (with mirrors for steps that undo others). Undoing an event that is not the
  document's latest change maps its inverses over the event's later steps, the log since it and
  the inverses already applied, as prosemirror-history does with remote changes; a step that no
  longer applies is left out. Received steps from the server and collab rebases are in the log
  too.
- **Grouping** follows prosemirror-history: changes in the same timeline within 500 ms that touch
  the last change, with the same `composition` (typing in a header or footnote), or appended by a
  plugin join the last event; `closeHistory` starts a new one. At most 100 events per timeline; the
  log is trimmed to what the oldest event needs.
- Undo transactions carry prosemirror-history's `history$` metadata, which the suggestion
  rewriting, the collab plugin and the tab plugin look for.
