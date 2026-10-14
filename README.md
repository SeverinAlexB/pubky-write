# Docs

A single-user document editor: a document list, a
page-style rich-text editor with autosave, version history and export to Word,
Markdown and PDF.

The design follows how the reference product saves edits (see
[docs/research.md](docs/research.md)), so real-time collaboration can be added
later without changing the storage model.

## Requirements

- Node.js 24 or later
- Chrome, for the end-to-end tests only

## Run it

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. The API server runs on port 3001, and Vite proxies
`/api` and `/uploads` to it.

Documents and uploaded images are stored in `data/` (`docs.sqlite` and
`uploads/`). Set `DATA_DIR` to store them elsewhere.

For a production build served from one port:

```bash
npm run build
npm start          # http://localhost:3001
```

## Backups

```bash
npm run backup
```

This writes `backups/<timestamp>/` with a copy of the database (`docs.sqlite`) and
the `uploads/` directory, and deletes all but the 20 newest backups. The database
is copied with SQLite's `VACUUM INTO`, which reads one consistent snapshot, so it
is safe to run while the server is running. `DATA_DIR` and `BACKUP_DIR` override
the `data/` and `backups/` directories.

To restore a backup:

1. Stop the server.
2. Move the current `data/` directory aside, for example to `data.old/`.
3. Copy the backup into place:
   `cp -R backups/<timestamp> data` (a fresh `data/` with `docs.sqlite` and
   `uploads/`). Do not copy `docs.sqlite-wal` or `docs.sqlite-shm` files from the
   old directory: they belong to the old database.
4. Start the server and check your documents, then delete `data.old/`.

## Features

- **Document list:** a grid of page thumbnails or a list grouped by date
  (Today, Previous 7 days, Previous 30 days, Earlier); search titles and
  contents; sort by last opened, last modified or title; rename, remove or open
  in a new tab from each document's ⋮ menu. The view, sort and owner filter are
  remembered in the browser. Thumbnails are drawn from the top of each
  document's first page when its tile scrolls into view.
- **Templates:** a blank document or one of four built-in templates (Letter,
  Resume, Project proposal, Report, in `shared/src/templates.ts`).
- **Import:** Open file picker opens Word (.docx) and Markdown (.md) files up to
  20 MB as new documents (see [How import works](#how-import-works)).
- **Editor:** paragraph styles (Normal text, Title, Subtitle, Heading 1–6,
  ⌘⌥0–6), fonts and font sizes, bold, italic, underline, strikethrough (⌘⇧X),
  superscript (⌘.), subscript (⌘,), capitalisation (lowercase, UPPERCASE,
  Title Case), text and highlight colour, paint format, links, images (upload,
  by URL, paste or drag and drop), tables (Insert > Table size grid), bulleted
  and numbered lists with glyph and numbering presets, checklists (⌘⇧9),
  alignment, line spacing, space before and after paragraphs (Custom spacing),
  indentation (Tab, Shift+Tab, ⌘] and ⌘[), page breaks (⌘↵), quotes, code
  blocks, horizontal lines, undo and redo, zoom (presets, typed or Fit).
- **Menus and toolbar:** a File / Edit / View / Insert / Format / Tools menu
  bar with submenus and keyboard navigation, and a toolbar whose controls move
  into a "More" row when the window is narrow. Both follow the WAI-ARIA menubar
  and toolbar patterns: each is one Tab stop, ← → move within it, and Escape
  returns to the document. Alt+F10 moves from the document to the toolbar. Menu items for features that
  are not built yet are shown disabled; they call the optional actions listed
  in `client/src/editor/actions.ts`.
- **Pages:** the document is shown as separate pages of its paper size with a
  10px gap between them; text that does not fit continues on the next page,
  line by line. File > Page setup sets orientation, paper size (A4, Letter,
  Legal, A5, A3) and margins per document; new documents use Letter in the
  United States and A4 elsewhere. A horizontal and a vertical ruler (in
  centimetres, or inches in the United States) show the margins and the current
  paragraph's indents. View > Show ruler and View > Show print layout (off for
  one continuous sheet) are remembered in the browser.
- **Find** (⌘F): a card at the top right of the editor area highlights every
  match as you type, Enter and Shift+Enter move between them. **Find and
  replace** (⌘⇧H) adds match case, JavaScript regular expressions (`$1` in the
  replacement inserts a group) and ignoring diacritics (on by default, so
  "cafe" finds "café"); Replace all is one undo step.
- **Word count** (⌘⇧C) shows pages, words and characters for the document or
  the selection, and can show a live count at the bottom left of the editor
  area.
- **Tabs and outline:** a sidebar (the list button at the top left, or View >
  Expand tabs and outlines sidebar) shows the document's tab with its number of
  open comments, and an outline of the Title and Heading 1–6 paragraphs, indented
  by level, with the heading at the cursor highlighted. Clicking a heading
  scrolls it to the top. Whether the sidebar is open is remembered.
- **Comments:** select text and choose Add comment on the floating pill, the
  toolbar, Insert > Comment or ⌘⌥M. Threads are cards in a margin right of the
  pages, level with their text and stacked 8px apart; the active card sits
  exactly beside its text. Reply, edit or delete messages and replies, resolve,
  copy a link that opens the document with the thread active (`?comment=<id>`),
  and delete threads. Comments stay attached to their text while you edit; if
  the text is deleted, the thread remains and shows the original text as
  deleted. View > Comments > Show all comments (⌘⌥⇧A, or the header button)
  lists all, open or resolved threads, where resolved ones can be reopened;
  Hide comments (⌘⌥⇧J) hides the margin and highlights and is remembered.
- **Autosave:** edits are sent about 300 ms after you stop typing. The header
  shows whether changes are saving, saved, or waiting for the connection to come
  back.
- **Version history** (File > Version history > See version history, ⌘⌥⇧H or
  the clock button): edits are grouped into sessions separated by 5 minutes of
  inactivity. History mode replaces the header and toolbar with a top bar (Back,
  the selected version's time, Print, zoom) and lists the versions by day in a
  panel on the right, the newest marked "Current version". The selected version
  is shown as read-only pages. With Highlight changes (on by default), text it
  added compared with the version before it is marked in teal and text it
  removed is struck through in red; "Total: N edits" counts the changes and
  Previous edit / Next edit scroll between them. Each version's ⋮ menu can
  restore it (after a confirmation; the restore becomes a new version), name it,
  or make a copy as a new document. File > Version history > Name current
  version names the newest version, and the panel can show only named
  versions. Restoring replaces only the text that differs, so comments on
  unchanged text survive.
- **Export:** File > Download as Microsoft Word (.docx), plain text (.txt) or
  Markdown (.md). Word files use Word's Title, Subtitle and Heading 1–6 styles
  and the document's page size, orientation and margins.
  In Markdown, Title becomes a level 1 heading, Subtitle a plain paragraph,
  checklists `- [ ]` / `- [x]`, superscript and subscript `<sup>` / `<sub>`,
  and a page break the comment `<!-- page break -->`. PDF uses the browser's
  print dialog with print styles that output only the pages, on the document's
  paper size and margins. Edit > Copy as
  Markdown copies the selection.
- **Make a copy:** File > Make a copy creates "Copy of <title>" without the
  comments.

Keyboard shortcuts follow the reference product, for example ⌘K for links, ⌘⌥1–3 for
headings, ⌘⇧8 for bulleted lists and ⌘⌥⇧H for version history.

## How saving works

The editor (Tiptap, built on ProseMirror) records every change as a ProseMirror
step. `client/src/editor/sync.ts` sends unsaved steps in batches:

1. Changes are debounced into a batch; only one batch is in flight at a time.
2. Each batch carries the document version it was built on.
3. The server (`server/src/documents.ts`) applies the steps to its copy of the
   document, stores them and returns the new version.
4. If the batch is based on an old version, the server answers `409` with the
   steps the client is missing. `prosemirror-collab` rebases the local steps on
   top of them and the batch is sent again.
5. Network errors are retried with backoff. A rejected batch (invalid step)
   stops saving and asks the user to reload.

The server validates every step against the same schema as the editor
(`shared/src/schema.ts`), so stored documents are always valid.

Comment anchors follow the same steps: the server moves every anchor through
each accepted batch (`server/src/comments.ts`), and the editor moves its copy
through every local change (`client/src/editor/commentAnchors.ts`). Both use the
same rule from `shared/src/anchors.ts`. A new comment is created only after
pending edits are saved, so its positions refer to the server's version.

To add real-time collaboration later, push accepted steps to other open
clients (for example over WebSocket) and apply them with `receiveTransaction`,
as the sync already does for conflicts.

## How pages work

Page settings are attributes of the document's top node (`shared/src/pageSetup.ts`),
changed with a ProseMirror `DocAttrStep`. They are saved, validated by the server,
undone and restored from version history like any other edit. Documents saved
before page settings existed open as A4 portrait with 2.54 cm margins.

On screen the editor is one content column over a stack of page sheets
(`client/src/editor/pagination.ts`). After each change the editor measures where
blocks and lines fall and inserts spacer widgets (decorations, not document
content) that push the next line past the bottom margin, the gap and the next
page's top margin. The rules are in `client/src/editor/pageLayout.ts`. Images,
tables and other atomic blocks move to the next page whole; one taller than a
page overflows. Printing hides the spacers and lets the browser break pages with
the same page size and margins.

## How import works

The server converts the file into the shared schema (`server/src/import/`) and
checks the result against it before creating the document.

- **Word** (`docx.ts`, with JSZip and xml-js): Title, Subtitle and Heading 1–9
  styles (7–9 become Heading 6, outline levels count as headings), alignment,
  line spacing, space before and after, indentation; bold, italic, underline,
  strikethrough, superscript, subscript, text colour, highlight, font size and
  font; links (hyperlinks and HYPERLINK fields); bulleted and numbered lists
  with the closest list preset, continued numbering and nesting; paragraphs
  starting with ☐ or ☑ (as the Word export writes checklists) become
  checklists; tables with merged cells and header rows; PNG, JPEG, GIF and WebP
  images (stored in `uploads/`); line and page breaks; page size, orientation
  and margins. Deleted tracked changes are left out.
- **Markdown** (`markdown.ts`, with markdown-it): headings, emphasis,
  strikethrough, inline code, links, lists and `- [ ]` checklists, quotes, code
  blocks, horizontal lines, tables with column alignment, images (data URLs are
  stored, web addresses kept), `<u>`, `<sup>`, `<sub>`, `<mark>` and
  `<!-- page break -->`. A `#` heading becomes Heading 1, since Markdown cannot
  tell it apart from a Title.

Everything else is dropped, and the editor shows which kinds of content were
left out: headers and footers, footnotes, comments, equations, text boxes,
charts and shapes, embedded objects, images in other formats or from local
paths, and other HTML.

## How the comment margin works

The pages and the comment margin sit side by side in one centred column
(`client/src/editor/CommentMargin.tsx`), so cards scroll with the text. After
every editor transaction, resize or zoom change the margin reads the top of each
anchor's line from the editor (`coordsAtPos`, which already includes page spacers
and zoom) and the height of each card, then `commentLayout.ts` stacks the cards in
document order: the active card stays at its line and the others move out of its
way with an 8px gap.

## How highlight changes works

`shared/src/versionDiff.ts` compares a version with the one before it (the oldest
with an empty document). It first matches equal top-level blocks (a longest common
subsequence), then compares the text of each run of changed blocks with
ProseMirror's changeset, which finds the changed characters and widens changes
inside a word to the whole word. Each resulting range is one edit. The preview
(`client/src/editor/HistoryMode.tsx`) is a read-only editor with the same
pagination as the editor; `versionHighlight.ts` marks added text and inserts the
removed text, struck through, where it was.

## Project layout

| Path      | Contents                                                       |
| --------- | -------------------------------------------------------------- |
| `shared/` | Document schema, API types and Markdown export used by both sides |
| `server/` | Hono API, SQLite storage (`node:sqlite`), revisions, exports   |
| `client/` | React app: document list, editor, toolbar, version history     |
| `e2e/`    | Playwright end-to-end tests                                    |
| `docs/`   | Research notes on the save protocol                |

## API

| Method and path                                      | Purpose                                 |
| ---------------------------------------------------- | --------------------------------------- |
| `GET /api/documents?q=&sort=`                        | List or search documents                |
| `POST /api/documents`                                | Create a document (blank or `template`) |
| `POST /api/documents/import`                         | Open a .docx or .md file as a new document (multipart `file`) |
| `GET /api/documents/:id/preview?v=`                  | The top of the first page, for thumbnails |
| `POST /api/documents/:id/copy`                       | Make a copy                             |
| `GET /api/documents/:id`                             | Open a document (content, version, comments) |
| `PATCH /api/documents/:id`                           | Rename                                  |
| `DELETE /api/documents/:id`                          | Delete                                  |
| `POST /api/documents/:id/steps`                      | Submit a batch of steps                 |
| `GET /api/documents/:id/revisions`                   | List versions                           |
| `GET /api/documents/:id/revisions/:revisionId`       | Get one version's content               |
| `POST /api/documents/:id/revisions/:revisionId/restore` | Restore a version                    |
| `PATCH /api/documents/:id/revisions/:revisionId`     | Name a version (a blank name removes it) |
| `POST /api/documents/:id/revisions/current/name`     | Name the current version                |
| `POST /api/documents/:id/revisions/:revisionId/copy` | Make a copy of a version                |
| `GET /api/documents/:id/export/:format`              | Download as `docx` or `md`              |
| `POST /api/documents/:id/comments`                   | Start a comment thread on a range       |
| `POST /api/documents/:id/comments/:commentId/replies` | Reply to a thread                      |
| `PATCH /api/documents/:id/comments/:commentId`       | Resolve or reopen a thread              |
| `DELETE /api/documents/:id/comments/:commentId`      | Delete a thread                         |
| `PATCH /api/documents/:id/comments/:commentId/messages/:messageId` | Edit a message's text     |
| `DELETE /api/documents/:id/comments/:commentId/messages/:messageId` | Delete a reply (not the first message) |
| `POST /api/uploads`                                  | Upload an image (PNG, JPEG, GIF, WebP)  |

## Tests

```bash
npm test             # unit tests: step authority, revisions, comments, exports, imports, sync, search
npm run e2e          # browser tests against a throwaway server and data directory
npm run typecheck
npm run perf         # performance with a 60-page document, against the production build
```

`npm run perf` builds the client, opens a 60-page document with 40 comments, the
outline and the live word count, and prints the time to open it, the time until
the pages settle and frame times while typing on pages 1 and 50. Set
`PERF_CPU_THROTTLE=4` to emulate a slower computer and
`PERF_PROFILE=<file>.cpuprofile` to record a CPU profile of typing on page 50.

## Limitations

- One user, no accounts or sharing.
- Tables are not split across pages, and printed page breaks can differ
  slightly from the screen because the browser paginates the printout.
- No headers, footers or page numbers.
- Comments are not included in exports. The author is always "You"; emoji
  reactions and renaming the tab are not available yet.
- No suggestion mode or real-time collaboration yet.
