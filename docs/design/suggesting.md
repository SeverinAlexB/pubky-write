# Design: suggesting mode

Our own design for spec 16.

## Data model

Suggestions are part of the document, so they are saved, synced, undone, versioned and exported
like any other content. Every suggestion has an `id` (a short random string), an `author` (always
"You" for now) and `createdAt` (Unix milliseconds). All parts of one suggestion share its id.

| What | Stored as |
| --- | --- |
| Inserted text | Mark `suggestionInsert` `{ id, author, createdAt }` on the inserted inline content (text, tabs, line breaks, footnote references, page fields). |
| Deleted text | Mark `suggestionDelete` `{ id, author, createdAt }`. The text stays in the document until the suggestion is accepted. |
| Text format change | Mark `suggestionFormat` `{ id, author, createdAt, before }`. The new formatting is applied normally; `before` is the list of formatting marks (as JSON) the text had before the first suggested change, so rejecting can restore it. |
| Paragraph format change (style, alignment, spacing, indents, lists) | Attribute `suggestionFormat` of paragraphs and headings: `null` or `{ id, author, createdAt, before: { type, attrs, list } }` with the block's node type, its attributes and the list it was in (`{ type, preset }` or `null`) before the first suggested change. |
| Paragraph break inserted (Enter) or deleted (Backspace at the start of a paragraph) | Attribute `suggestionBreak` of paragraphs and headings: `null` or `{ kind: "insert" \| "delete", id, author, createdAt }`. It describes the boundary between this textblock and the previous one. |
| Object inserted or deleted (image, table, table row, table cell, page break, column break, horizontal line, table of contents) | Attributes `suggestionInsert` and `suggestionDelete` of those node types: `null` or `{ id, author, createdAt }`. The object stays in the document until the suggestion is accepted or rejected. A suggested column is the cells of that column, one suggestion. |
| Footnote inserted or deleted | The `suggestionInsert` / `suggestionDelete` mark on the reference, like text. |
| Image changed (size, wrapping, margin, position, rotation, crop, colour adjustments, alt text, Replace image) | Attribute `suggestionFormat` of images: `null` or `{ id, author, createdAt, before }`, with the image's attributes (without the suggestion ones) before the first suggested change. The new values are applied. |
| Text in a header, footer or footnote | The same marks and attributes inside the region's content (the document attribute or the footnote's `content`). |

The three marks are defined last in the schema, so their `<span>` is the innermost and its colour
wins over a text colour. They are not inclusive (text typed at their edges in Editing mode does not
join them). Both attributes have defaults and `validate` functions and are not kept on split, so
documents saved before them load unchanged and the server rejects malformed values. The marks
parse from their own `data-suggestion-*` HTML (ProseMirror re-reads the DOM in some input paths),
but the editor strips all suggestion marks and attributes from pasted content.

Every new attribute has a default (`null`) and a `validate` function: documents saved before them
load unchanged, stored steps apply as before, and the server rejects malformed values (an image's
`before` may only hold image attributes with plain values). Pasted content loses all of them.

The model lives in `shared/src/suggestions.ts`: the extensions, `collectSuggestions(doc)` (one
entry per id, in document order, with its range, its inserted and deleted text, the objects it
inserts or deletes, and its changes), `describeSuggestion`, `applySuggestions(transform, "accept" |
"reject", ids)` and `acceptedDocument(doc)`.

## Suggesting mode: rewriting transactions

`client/src/editor/suggesting.ts` registers a Tiptap `dispatchTransaction` hook. In Suggesting mode
it replaces each transaction that changes the document with an equivalent one built from the old
state, before it is applied. Transactions are passed through unchanged when they are undo/redo
(`history$` meta), not added to history (collab rebasing, received steps), marked as suggestion
commands (accept/reject) or only change document attributes.

1. **Content changes** (the transaction contains `ReplaceStep`s and no `ReplaceAroundStep`): the
   changes are computed with `prosemirror-changeset` from the step maps, as ranges of the old
   document (`fromA`–`toA`) replaced by ranges of the new one (`fromB`–`toB`). If every changed range
   holds only inline content and boundaries between paragraphs, headings and list items, a new
   transaction is built from the old state, change by change:
   - Inline content in `fromA`–`toA` that is a pending insertion by the same author is really
     deleted; other content gets `suggestionDelete` (content already deleted keeps its id).
     Paragraph boundaries in the range get `suggestionBreak: delete` on the following textblock,
     or are really removed when they were suggested insertions.
   - The inserted content `doc.slice(fromB, toB)` is inserted after the deleted text with
     `suggestionInsert` on all its inline content (other suggestion marks removed). Textblocks
     that start inside the inserted range get `suggestionBreak: insert`.
   - The selection is mapped into the new document. A collapsed cursor that was at the end of a
     deleted range (Backspace) ends before the struck-through text, otherwise after it.
   Whole objects in a changed range (an image, a table, a table row or cell, a break, a horizontal
   line, a table of contents) are treated like text: a deleted object gets `suggestionDelete` (or is
   really removed when it is a pending insertion by the same author), an inserted one
   `suggestionInsert`; the text inside an inserted table carries the mark as well. Edits inside an
   object that is itself a pending insertion (typing in a new table, deleting one of its rows) are
   part of that insertion. The changeset's diff can match structure across an object (the empty
   paragraph a new table replaced, kept as the paragraph in its first cell); when the changes are
   not expressible, they are computed again with block tokens that never match. Changes that touch
   anything else (part of a table's structure together with a `ReplaceAroundStep`, a table of
   contents being updated) are applied directly, as in Editing mode.

   An inserted or deleted object is always a suggestion of its own: it does not join the current
   group and typing after it starts a new one. All the object changes of one transaction share one
   id (the cells of an inserted column). Changing an image replaces the leaf node with a changed
   copy (`setNodeMarkup` of a leaf is a `ReplaceStep`); such steps count as format changes, below.
   Dragging an image to another paragraph (one step deleting it, one inserting the same picture) is
   applied directly. Transactions with the meta `suggestionDirect` (`applyDirectly`) are applied
   directly too: merging and splitting cells (the spec applies them directly) and sorting a table.
2. **Format changes** (only mark, attribute and `ReplaceAroundStep` steps): the transaction is
   applied as it is, then, for the text and the textblocks it touched, the formatting before (read
   from the old document, or the `before` of an existing format suggestion) is compared with the
   formatting after. Where they differ the text gets `suggestionFormat` / the block gets the
   `suggestionFormat` attribute; where a change was undone by another one the record is removed.
   Images changed by the transaction get the image `suggestionFormat` the same way ("Format:
   image"). Pending insertions by the same author are formatted directly. Turning paragraphs into a
   list is a paragraph format change; its card says "Format: bulleted list" (or numbered list,
   checklist), while changing a list's kind keeps the "Format bullet" line.

Backspace and Delete with a collapsed cursor skip over text that is already struck through, so a
second Backspace deletes the next character instead of doing nothing.

All steps produced are ordinary `ReplaceStep`, `AddMarkStep`, `RemoveMarkStep`, `AttrStep` and
`ReplaceAroundStep`s. The sync (`sync.ts`), the server's step authority and the comment anchors
see nothing new. Marking text as deleted does not move positions, so comments on it keep their
anchors on the server and in the editor.

Automatic formatting (`autoformat.ts`, see [everyday-editing.md](everyday-editing.md)) can both
delete and format text in one change (a Markdown shortcut removes `**` and makes the text bold), or
delete text and change a paragraph (`## ` starts a heading). `suggestParts` builds such a change
from parts that are rewritten one after the other and combined into one transaction, so each part
becomes the right kind of suggestion; the dispatch hook passes the result through.

### Grouping

The editor keeps the current group `{ id, time }`. A content change reuses the group's id when it
touches (overlaps or is adjacent to) content of that suggestion and the last edit was less than 2
minutes ago. A change inside a pending insertion (same id on both sides) reuses that insertion's id.
Otherwise it starts a new suggestion. So typing, Backspace and typing again at the same place
form one suggestion (a "Replace"); clicking elsewhere and typing starts a new one. A format change
on text that already has a format suggestion keeps that suggestion's id and original `before`.

## Accepting and rejecting

`applySuggestions` works on any `Transform`, one transaction, so each accept or reject (and Accept
all / Reject all) is one undo step. It first applies the steps that do not move positions
(removing marks, restoring `before` marks, resetting block types and attributes), then deletes
ranges from the end of the document to the start:

| | Accept | Reject |
| --- | --- | --- |
| Insert | remove the mark | delete the content |
| Delete | delete the content | remove the mark |
| Text format | remove the mark | replace the formatting marks with `before` |
| Paragraph format | clear the attribute | restore the node type, attributes and list |
| Break insert | clear the attribute | join with the previous textblock |
| Break delete | join with the previous textblock | clear the attribute |
| Object insert | clear the attribute | delete the object |
| Object delete | delete the object | clear the attribute |
| Image format | clear the attribute | set the attributes in `before` |
| Header, footer, footnote text | the region's content accepted (`DocAttrStep` / `AttrStep`) | the region's content rejected |

A join deletes the range from the end of the previous textblock to the start of this one, only if
nothing but closing and opening tokens of textblocks, list items and lists (and objects removed
by the same action) lies between them. Deleted ranges are merged before they are deleted, so an
image removed inside a join's range is deleted once. A table row whose cells are all removed, or a
table whose rows are all removed, is removed whole.

## Headers, footers and footnotes

Their content is a document attribute (headers, footers) or the footnote reference's `content`
attribute, edited in a region editor (see [page-elements.md](page-elements.md)). The region editor
has the same `Suggesting` extension as the body: in Suggesting mode its edits become suggestion
marks and attributes inside its own document, which it then writes to the attribute as before. So
the data model and the rewriting are the same, and an undo undoes the attribute change.

- **Mode.** The region editor follows the main editor's mode (set when it is created and on every
  main transaction). The text of a footnote whose reference is itself a pending insertion by the
  same author is edited directly: it is part of that insertion.
- **Reading.** `collectSuggestions` also reads the header and footer attributes and every
  footnote's content (parsed once per content array, and only when the JSON holds a suggestion).
  Their entries have `region: { key, footnotePos, from, to }` with the region's own positions;
  their `from` in the body is the start of the document (headers), its end (footers) or the
  footnote reference, which orders them in Review suggested edits. Headers and footers belong to
  every document tab.
- **Accepting and rejecting.** `applySuggestions` applies itself to the region's content and sets
  the attribute to the result, before any deletion in the body. Accept all and Reject all include
  them.
- **The active suggestion.** The main editor's plugin state holds the active id for all of them.
  The region editor's own plugin state has its suggestions (for its decorations and the cursor
  rule); a change of its active suggestion is copied to the main editor, and the main editor's to
  the region editor when the id is one of the region's.
- **Cards.** A region's cards are in the comment margin while it is edited, level with their line
  in the region editor (`regionTop`), and the active one also when the region is not edited (a
  suggestion selected in Review suggested edits), level with the region's first copy on the pages.
  Selecting one in the review card scrolls to that region.

## Cards, the margin and replies

Suggestion cards are entries of the comment margin (`CommentMargin.tsx`) with keys `s:<id>`, laid
out and stacked with comment cards by `commentLayout.ts`. The suggestions plugin
(`suggesting.ts`) keeps the list from `collectSuggestions` (recomputed only for transactions that
can affect suggestions, so documents without suggestions cost nothing while typing), the active
suggestion id and draws the active suggestion's 1px border as inline decorations. Clicking
suggested text or a card activates its suggestion. Every rewritten edit activates the suggestion
it made or extended (`made` in the rewrite result) with `activeFollowsCursor` set: that suggestion
stays active only while the selection head is within its `from`–`to`, so moving the cursor away
deactivates it (a click elsewhere does too). Activation is plugin state only: it neither moves
the focus nor scrolls; the margin aligns the active card with its text. A suggested paragraph break is shown as a green ¶ (struck through
for a deleted break) at the end of the paragraph before it, a widget decoration that is not part
of the document (not for an object put in place of an empty paragraph, which is outlined itself).

Suggested objects get node decorations (`suggestion-node-insert`, `-delete`, `-format`, and
`suggestion-active` on the active one), because images and tables have node views that draw their
own DOM; static copies (version history, headers on other pages) use the `data-suggestion-insert`
and `data-suggestion-delete` attributes their `renderHTML` writes. Inserted objects have a 2px
dashed outline in the suggestion colour (each cell of an inserted row or column); deleted images,
tables and tables of contents a 50% overlay striped in the suggestion colour; deleted rows and
columns have their text struck through over light stripes; suggested breaks and lines are drawn
in the suggestion colour and named ("Page break", struck through when deleted). A footnote whose
reference is suggested shows its text in the suggestion colour (struck through when deleted).

Replies are stored on the server in a new table `suggestion_replies (id, document_id,
suggestion_id, body, created_at)` and returned with the document as `suggestionReplies` (by
suggestion id). `POST /api/documents/:id/suggestions/:suggestionId/replies` adds one and
`DELETE /api/documents/:id/suggestions/:suggestionId/replies/:replyId` deletes one. Replies of
suggestions that no longer exist are not shown (they stay in the table, so undoing an accept
brings them back).

## Modes and display

The mode (`editing`, `suggesting`, `viewing`) is stored per document in localStorage
(`docs.mode.<documentId>`). Viewing mode and the review card's previews are display states:

- **Viewing** and **Preview accept all**: the editor is read-only, deleted text and objects are
  hidden and inserted and formatted text and objects are shown normally (CSS on the page stack;
  the pagination skips hidden objects, so a deleted page break no longer breaks the page). Viewing mode
  also hides comment highlights and the margin and disables the toolbar's editing controls and the
  Insert and Format menus.
- **Preview reject all**: read-only, inserted text and objects hidden, deleted ones shown normally. Formatting
  changes and paragraph breaks are still shown as suggested (a CSS preview cannot revert them).

While read-only, the dispatch hook drops any transaction that would change the document (except
accept/reject and synced steps), so menu commands cannot edit it. The pagination is laid out
again when the display state changes, because hidden text changes line breaks.

## Elsewhere

- **Viewing mode** does not open headers, footers and footnotes.
- **Word export** writes insertions as `w:ins`, deletions as `w:del` with `w:delText`, text
  format changes as `w:rPrChange` holding the previous run properties, and suggested paragraph
  breaks as an inserted or deleted paragraph mark (`w:pPr/w:rPr/w:ins|w:del`) on the paragraph
  before the break. Paragraph format changes are exported with their new formatting only.
  Inserted or deleted table rows are `w:trPr/w:ins|w:del` with their text inserted or deleted (a
  whole table: every row), cells of a suggested column `w:tcPr/w:cellIns|w:cellDel`; an image's,
  a page or column break's and a footnote reference's run is wrapped in `w:ins` or `w:del` (the
  footnote's text too), and the paragraph an image, break or horizontal line has to itself gets an
  inserted or deleted paragraph mark, so Word removes it whole. Image format changes and tables of
  contents beyond their text have no tracked form: the new values are written. The same applies
  in headers, footers and footnotes.
- **Word import** reads `w:ins` and `w:del` (`w:delText`) as suggestions with their author and
  date, `w:rPrChange` as text format suggestions and inserted or deleted paragraph marks as
  suggested breaks. Word gives every run its own revision, so adjacent revisions with the same
  author and date (with nothing else between them) become one suggestion: a deletion and the
  insertion replacing it, or an inserted paragraph mark and the text after it. Moves
  (`w:moveFrom`, `w:moveTo`) are read as deletions and insertions. Inserted or deleted rows and
  cells, and images, breaks and footnote references inside `w:ins` or `w:del`, become object
  suggestions, each of its own (the text of a row joins the row's); a paragraph holding nothing but
  such an object does not turn its paragraph mark into a paragraph break. Headers, footers and
  footnotes are read the same way.
- **Markdown, plain text and the server's search text** use the accepted result
  (`acceptedDocument`): deleted text is left out, inserted and formatted text is kept.
- **Word count, Find and the outline** read the accepted result too: deleted text (and the text
  of deleted objects, such as a deleted table row) is not counted, not matched and not shown in
  headings. A match on both sides of struck-through text spans it,
  so replacing that match replaces the struck-through text with it (as a suggestion in Suggesting
  mode).
- **Version history** shows suggestions with their styling, like the editor. The diff compares
  text, so a suggested deletion is not a change there until it is accepted. Restoring a version
  restores its suggestions.

## Known limits

- Moving an image by dragging, updating a table of contents, merging, splitting and sorting cells,
  removing a header or footer (Options > Remove header), and page setup, columns, headers' Different
  first page and page numbering are applied directly in Suggesting mode.
- A table change that also changes a cell's span (deleting a row through a merged cell, adding a
  column through one) is applied directly: it needs a `ReplaceAroundStep` the rewriting does not
  turn into suggestions.
- A suggestion that inserts or deletes objects and text is described by its objects only ("Add:
  Table", not the text typed in it).
- An object put in place of an empty paragraph keeps that paragraph, with its break suggested for
  deletion, until the suggestion is accepted (it then goes) or rejected (it stays).
- Image format changes are not shown in Preview reject all (as for text formatting, the preview
  hides and shows content but cannot restore earlier attributes).
