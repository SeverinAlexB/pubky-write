# Design: columns, column breaks and tables across pages

Our own design for the column and table parts of spec 19.

## Data model

| What | Stored as |
| --- | --- |
| Number of columns, spacing, line between columns | Document attributes `columns` (1–3, default 1), `columnSpacing` (points, default 36 = 1.27 cm, at most 216) and `columnLine` (boolean, default `false`) in `shared/src/columns.ts`, changed with a `DocAttrStep` like the page setup. |
| Column break | Block leaf node `columnBreak` (atom, selectable), like `pageBreak`. Not allowed in headers, footers or footnotes. |
| Pinned header rows | The header rows at the top of a table: rows whose cells are all `tableHeader` cells. No new attribute. |

Every attribute has a default and a `validate` function, so documents saved before columns open with
one column, stored steps apply unchanged and the server rejects invalid values. Restoring a version
sets the column attributes back like the page setup (`replaceDifference`).

**Columns are per document, not per tab.** Like the page setup, headers and footers, the settings
are attributes of the document node, so all document tabs share them. The spec applies columns to
the whole document (sections are out of scope); a document tab is not a section, and Word exports
of all tabs are one section too.

**Pinned rows are header rows** because Word's "Repeat as header row at the top of each page"
(`w:tblHeader`) is the same feature: the export already wrote header rows that way and the import
already read them back, Sort keeps them on top, and older documents with header rows (from Word or
Markdown imports) now show as pinned. Pin header row turns the cells of the rows from the top to the
cursor's row into header cells, Unpin header rows turns every leading header row back. Both change
only the cells' type (`setNodeMarkup`), so their content and comments stay. A table whose every row
is a header row repeats nothing (there would be nothing under the repeated rows).

## Columns in the pagination

The page's content becomes a CSS multi-column box (`column-count`, `column-gap`, `column-fill:
auto`) when the document has more than one column and print layout is on. The browser cannot break
columns into pages, so the pagination decides where each column ends and draws that with the same
kind of spacer widgets it already used for pages:

- Within a page, a **forced column break**: an empty block with `break-before: column`.
- Between pages, a **spanner**: an empty block with `column-span: all`, as tall as the rest of the
  page below the page's tallest column plus the next page's top margin. A spanner ends the columns
  of one page and starts a new set of columns on the next.

The browser balances the columns before a spanner. To leave it no choice, every page gets exactly
one forced break per column boundary (also for empty columns, for example after a page break in the
first column), and a break that starts an empty column is as tall as the page's tallest column, so
balancing cannot spread the columns before it over the empty one. The last page ends the same way,
with an empty spanner after the content (a widget at the end of the shown tab), so its columns are
balanced like the others rather than filled in order (`column-fill: auto`, which in Firefox, without
a height, puts everything in the first column).

Firefox has no forced column breaks (`break-before: column` is not supported; `supportsColumnBreaks`
checks). There the content of every column but the tallest of its page is followed by a filler
(`.column-filler`) that takes it to 1px under the tallest column, so the only way balancing can fit
the page is to break the columns where the pagination did.

A spacer is a `display: contents` wrapper with its breaks and spanner, at the line or block where the
next column starts. Spacers work both between blocks and inside a paragraph (between two of its
lines), inside lists and inside document tab wrappers.

In Safari an element inside the multi-column box also has an empty box for each later row of
columns, at a wrong place, and `getBoundingClientRect` includes them. Code that measures elements in
the content uses `clientRect` (`rects.ts`), which leaves empty boxes out.

### Measuring

`paginate` (in `pageLayout.ts`) treats the columns as a strip of *slots*: slot *s* is column
`s % columns` of page `floor(s / columns)`, laid out like a page of its own. The same line and block
rules fill each slot before the next; a column break starts the next slot, a page break the first
slot of the next page. Footnotes take their space from the page of their reference, for all of its
columns. With one column a slot is a page and nothing changes.

To measure natural positions, the pagination lays the content out flat for a moment
(`measureColumnsFlat`): one column as wide as a column (the right padding grows by the other columns'
widths), with every spacer hidden. Positions are then natural without subtracting spacer shifts,
and the class is removed before anything is painted. The scroll position is restored in case scroll
anchoring moved it.

The height of a spanner depends on how tall the browser draws the page's columns. It is estimated
from the measured slot heights, and then corrected from the drawn columns (`drawnColumnHeights`,
read before measuring): the plugin lays out twice in the same frame when the document has columns,
so the corrected spanners are what is painted.

### Line between columns, tab stops, print

- The line is a 1px black element per column gap and page, from the top to the bottom of the
  page's content, in a layer of its own over the page sheets (`.column-lines`), so it prints.
- Tab stops count from the left edge of the paragraph's column (`tabLayout.ts`).
- Printing prints the pages as laid out, multi-column box included: before printing the pagination
  lays the pages out without gaps, so each page's columns and spanner fit the printed page.
- Without print layout (pageless) the document has one column; the setting is kept.

## Tables across pages

A table used to move to the next page whole. It now breaks between rows: its layout box has one
"line" per row (`tableRowLines` in `tableLayout.ts`), and rows joined by a cell merged across them
are one line. A row that does not fit moves to the next page with a spacer *between two rows*: a
widget inside the table's `tbody`, a `display: contents` wrapper with

1. a row without borders as tall as the rest of the page (`.table-page-gap`), and
2. copies of the pinned rows (`.table-repeat-row`, not editable, ignored by the pointer).

The line has a `carry`, the height of the pinned rows, and `paginate` moves it to the next page's top
plus that height, so the copies fit above it. The copies are drawn from the table's own rows when
the widget is created; the spacer's key includes a hash of the pinned rows' content, so editing a
pinned row draws the copies again. With columns a table still moves whole (a spanner cannot be
inside a table).

## Exports and import

- Word: `w:cols` with `w:num`, `w:space` and `w:sep` in the section, `w:br w:type="column"` for column
  breaks, `w:tblHeader` for pinned rows. Import reads all of them (up to three columns).
- Markdown and plain text leave columns and column breaks out.

## Known limits

- Columns are always equal; there is no per-section or per-tab setting.
- The ruler shows the whole content width, not the column the cursor is in.
- A footnote referenced in a later column of a page can overlap the end of an earlier column, which
  was laid out before the footnote's space was known.
- With columns, tables move whole and a table taller than a column overflows it.
- A column's first block keeps its top margin (lists, tables, images: 8px), so it starts slightly
  below the top margin.
