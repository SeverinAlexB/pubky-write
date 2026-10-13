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
- **Editor:** paragraph styles (normal text, headings 1–3), bold, italic,
  underline, strikethrough, text and highlight colour, links, images (toolbar,
  paste or drag and drop), tables, bulleted and numbered lists, alignment,
  quotes, code blocks, horizontal lines, undo and redo, zoom.
- **Autosave:** edits are sent about 300 ms after you stop typing. The header
  shows whether changes are saving, saved, or waiting for the connection to come
  back.
- **Version history:** edits are grouped into sessions separated by 5 minutes
  of inactivity. Select a version to preview it, then restore it.
- **Export:** File > Download as Word (.docx) or Markdown (.md). PDF uses the
  browser's print dialog with print styles that output only the page.

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

To add real-time collaboration later, push accepted steps to other open
clients (for example over WebSocket) and apply them with `receiveTransaction`,
as the sync already does for conflicts.

## Project layout

| Path      | Contents                                                       |
| --------- | -------------------------------------------------------------- |
| `shared/` | Document schema and API types used by both sides               |
| `server/` | Hono API, SQLite storage (`node:sqlite`), revisions, exports   |
| `client/` | React app: document list, editor, toolbar, version history     |
| `e2e/`    | Playwright end-to-end tests                                    |
| `docs/`   | Research notes on the save protocol                |

## API

| Method and path                                      | Purpose                                 |
| ---------------------------------------------------- | --------------------------------------- |
| `GET /api/documents?q=&sort=`                        | List or search documents                |
| `POST /api/documents`                                | Create a document                       |
| `GET /api/documents/:id`                             | Open a document (content and version)   |
| `PATCH /api/documents/:id`                           | Rename                                  |
| `DELETE /api/documents/:id`                          | Delete                                  |
| `POST /api/documents/:id/steps`                      | Submit a batch of steps                 |
| `GET /api/documents/:id/revisions`                   | List versions                           |
| `GET /api/documents/:id/revisions/:revisionId`       | Get one version's content               |
| `POST /api/documents/:id/revisions/:revisionId/restore` | Restore a version                    |
| `GET /api/documents/:id/export/:format`              | Download as `docx` or `md`              |
| `POST /api/uploads`                                  | Upload an image (PNG, JPEG, GIF, WebP)  |

## Tests

```bash
npm test             # unit tests: step authority, revisions, exports, sync
npm run e2e          # browser tests against a throwaway server and data directory
npm run typecheck
```

## Limitations

- One user, no accounts or sharing.
- The page is one continuous sheet; page breaks appear only when printing.
- No comments, suggestions or real-time collaboration yet.
