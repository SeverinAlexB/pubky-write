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

## Features

- **Document list:** create, open, rename, delete, search titles and contents,
  sort by last opened, last modified or title.
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
  into a "More" row when the window is narrow. Menu items for features that
  are not built yet are shown disabled; they call the optional actions listed
  in `client/src/editor/actions.ts`.
- **Find and replace** (⌘F, ⌘⇧H) with match case, **word count** (⌘⇧C) for the
  document or the selection, and a **document outline** of all headings.
- **Comments:** select text and add a comment (⌘⌥M), reply, resolve, reopen or
  delete. Comments stay attached to their text while you edit; if the text is
  deleted, the thread remains and shows the original text as deleted.
- **Autosave:** edits are sent about 300 ms after you stop typing. The header
  shows whether changes are saving, saved, or waiting for the connection to come
  back.
- **Version history:** edits are grouped into sessions separated by 5 minutes
  of inactivity. Select a version to preview it, then restore it. Restoring
  replaces only the text that differs, so comments on unchanged text survive.
- **Export:** File > Download as Microsoft Word (.docx), plain text (.txt) or
  Markdown (.md). Word files use Word's Title, Subtitle and Heading 1–6 styles.
  In Markdown, Title becomes a level 1 heading, Subtitle a plain paragraph,
  checklists `- [ ]` / `- [x]`, superscript and subscript `<sup>` / `<sub>`,
  and a page break the comment `<!-- page break -->`. PDF uses the browser's
  print dialog with print styles that output only the page. Edit > Copy as
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
| `POST /api/documents`                                | Create a document                       |
| `POST /api/documents/:id/copy`                       | Make a copy                             |
| `GET /api/documents/:id`                             | Open a document (content, version, comments) |
| `PATCH /api/documents/:id`                           | Rename                                  |
| `DELETE /api/documents/:id`                          | Delete                                  |
| `POST /api/documents/:id/steps`                      | Submit a batch of steps                 |
| `GET /api/documents/:id/revisions`                   | List versions                           |
| `GET /api/documents/:id/revisions/:revisionId`       | Get one version's content               |
| `POST /api/documents/:id/revisions/:revisionId/restore` | Restore a version                    |
| `GET /api/documents/:id/export/:format`              | Download as `docx` or `md`              |
| `POST /api/documents/:id/comments`                   | Start a comment thread on a range       |
| `POST /api/documents/:id/comments/:commentId/replies` | Reply to a thread                      |
| `PATCH /api/documents/:id/comments/:commentId`       | Resolve or reopen a thread              |
| `DELETE /api/documents/:id/comments/:commentId`      | Delete a thread                         |
| `POST /api/uploads`                                  | Upload an image (PNG, JPEG, GIF, WebP)  |

## Tests

```bash
npm test             # unit tests: step authority, revisions, comments, exports, sync, search
npm run e2e          # browser tests against a throwaway server and data directory
npm run typecheck
```

## Limitations

- One user, no accounts or sharing.
- The page is one continuous sheet; page breaks show as a dashed line and
  start a new page only when printing.
- Comments are listed in a side panel rather than aligned next to their text,
  and they are not included in exports.
- No suggestion mode or real-time collaboration yet.
