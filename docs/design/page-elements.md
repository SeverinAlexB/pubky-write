# Design: headers, footers, page numbers, footnotes, table of contents

Our own design for spec 13. Everything stays in the one ProseMirror document, so the step
protocol, the server's validation, undo, version history and comment anchors keep working
without changes to their code.

## Where the content lives

| Element | Stored as | Changed with |
| --- | --- | --- |
| Header, footer | Doc attributes `header`, `footer`, `firstPageHeader`, `firstPageFooter`: an array of block JSON, or `null` | `DocAttrStep` |
| Different first page | Doc attribute `differentFirstPage` (boolean) | `DocAttrStep` |
| Page number start | Doc attribute `pageNumberStart` (integer, default 1) | `DocAttrStep` |
| Page number / page count field | Inline leaf node `pageField` with `kind: "page" \| "count"` | ordinary steps |
| Footnote | Inline leaf node `footnote` at the reference; its text is the attribute `content` (array of paragraph JSON) | `AttrStep` for its text, ordinary steps for the reference |
| Table of contents | Block node `tableOfContents` (`style: plain \| dotted \| links`, atom, selectable) holding `tocEntry` text blocks (`indent`, `page`, `heading`) | ordinary steps |

Why attributes rather than top-level nodes for headers and footers:

- Select all + delete, find, word count, the outline, the version diff, Markdown and plain
  text exports and the server's plain-text search walk the document's content. Header text
  must not take part in any of them, and a top-level node would have to be excluded in every
  one of those places (and protected from being deleted by a select-all).
- Comment anchors are positions in the content. Attribute steps have empty step maps, so
  anchors never move when a header or footnote is edited.

Why the footnote text is an attribute of a leaf node: the reference counts as one character
(like an image), so search positions, anchors and the version diff stay correct; deleting the
reference deletes the footnote with it; copying it copies the text (the HTML carries the JSON
in `data-content`).

All region content is validated against the schema by the attribute's `validate` function
(it is parsed with `documentSchema` and checked). Headers and footers may not contain page
breaks, footnotes or tables of contents; footnote text is paragraphs only. Invalid steps are
rejected by the server like any other invalid step. Old documents have none of the attributes
and load with the defaults (`null`, `false`, `1`).

## Editing

A header, footer or footnote is edited in a second Tiptap editor (the *region editor*) with
the same schema, mounted in place on the page. Each of its document changes is turned into
one transaction on the main editor that sets the attribute to the region's new JSON. So:

- saving, syncing and versions are the main editor's (the steps are `DocAttrStep` /
  `AttrStep`);
- undo is the main editor's: ⌘Z in a region calls the main editor's undo. Keystrokes typed
  in quick succession share a `composition` id, which makes the history group them into one
  undo step (attribute steps have empty maps, so the history's usual adjacency test would
  otherwise make each keystroke its own step);
- when the main state changes the attribute (undo, redo, restore) the region editor replaces
  only the part of its content that differs, so the cursor stays where it was.

The toolbar and the Format menu act on the region editor while it is active (bold,
alignment, fonts…). Only one region editor exists at a time; every other header, footer and
footnote is a static rendering of its JSON (`DOMSerializer`).

## Rendering and pagination

The pagination plugin already measures the body and inserts spacer widgets. It now also:

1. Measures the header and footer of the first and the other pages (static HTML in a hidden
   measuring box at the content width, cached by content object). The header starts 48px
   from the top edge, the footer ends 48px from the bottom edge. A page's content starts at
   `max(margin top, 48 + header height)` and ends at `min(height - margin bottom, height - 48 -
   footer height)`. The first page can differ (different first page), so `PageFrame` has
   optional first-page margins and `.page-content` is padded with `--content-top`.
2. Measures every footnote (cached the same way) and the reference's line. While breaking
   lines into pages, a line that carries references needs room for its footnotes (plus the
   20px separator block if it is the page's first footnote) above the page's content
   bottom; otherwise the line moves to the next page with its footnotes. The result is the
   page of every footnote.
3. Publishes `{ pageCount, firstTop, top, firstBottom, bottom, footnotePages }` in its plugin
   state (only when it changes).

A React layer (`PageElements`) over the page stack draws, for every page, the header and
footer and the footnote area (separator line one third of the text width, 10pt entries) from
that layout. Page number fields show CSS counters: each region container sets
`counter-reset: docs-page <n>`, and the page stack sets the page count. Fields are therefore
generated text: find and word count never see them, and TOC page numbers (an attribute
drawn with a pseudo-element) are not matched either.

Footnote numbers are the reference's order in the document: a CSS counter in the body, and
the index in the footnote areas and exports.

## Printing

With print layout on, printing prints the pages as laid out on screen: before printing
(`beforeprint`, or the editor's own Print) the pagination lays the pages out again with no
gap between them and zoom 1, the `@page` rule uses the page size in CSS pixels with no
margins, and the spacers, headers, footers and footnote areas print where they are. After
printing the gap comes back. Without print layout the browser paginates as before.

## Table of contents

Built from the Title and Heading 1–6 paragraphs (empty ones skipped) when inserted and when
"Update table of contents" is chosen; it does not follow later edits. Page numbers come from
the current layout and are stored on the entries, then refreshed once more after the pages
have settled (merged into the same undo step), since inserting the table itself moves the
headings. Entries jump to their heading on click in the "links" style: the heading is found
by its text (the n-th heading with that text), falling back to its index.

## Exports and import

- Word: headers and footers (with `titlePage` for a different first page), `PAGE` and
  `NUMPAGES` fields, the page number start, real footnotes, and the table of contents as
  static paragraphs (right tab stop, dotted leader for the dotted style; internal links to
  bookmarks on the headings for the links style).
- Markdown: footnotes as `[^1]` with the notes at the end, headers and footers left out,
  the table of contents as a nested list of links to heading anchors.
- Word import reads the default and first-page header and footer of the last section,
  `titlePg`, `pgNumType/@start`, PAGE / NUMPAGES fields and footnotes.
