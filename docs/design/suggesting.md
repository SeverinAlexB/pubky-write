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

The three marks are defined last in the schema, so their `<span>` is the innermost and its colour
wins over a text colour. They are not inclusive (text typed at their edges in Editing mode does not
join them). Both attributes have defaults and `validate` functions and are not kept on split, so
documents saved before them load unchanged and the server rejects malformed values. The marks
parse from their own `data-suggestion-*` HTML (ProseMirror re-reads the DOM in some input paths),
but the editor strips all suggestion marks and attributes from pasted content.

The model lives in `shared/src/suggestions.ts`: the extensions, `collectSuggestions(doc)` (one
entry per id, in document order, with its range, its inserted and deleted text and its changes),
`describeSuggestion`, `applySuggestions(transform, "accept" | "reject", ids)` and
`acceptedDocument(doc)`.

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
   Other changes (tables, images, page breaks, horizontal lines, a table of contents, whole lists)
   are applied directly, as in Editing mode.
2. **Format changes** (only mark, attribute and `ReplaceAroundStep` steps): the transaction is
   applied as it is, then, for the text and the textblocks it touched, the formatting before (read
   from the old document, or the `before` of an existing format suggestion) is compared with the
   formatting after. Where they differ the text gets `suggestionFormat` / the block gets the
   `suggestionFormat` attribute; where a change was undone by another one the record is removed.
   Pending insertions by the same author are formatted directly.

Backspace and Delete with a collapsed cursor skip over text that is already struck through, so a
second Backspace deletes the next character instead of doing nothing.

All steps produced are ordinary `ReplaceStep`, `AddMarkStep`, `RemoveMarkStep`, `AttrStep` and
`ReplaceAroundStep`s. The sync (`sync.ts`), the server's step authority and the comment anchors
see nothing new. Marking text as deleted does not move positions, so comments on it keep their
anchors on the server and in the editor.

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

A join deletes the range from the end of the previous textblock to the start of this one, only if
nothing but closing and opening tokens of textblocks, list items and lists lies between them.

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
of the document.

Replies are stored on the server in a new table `suggestion_replies (id, document_id,
suggestion_id, body, created_at)` and returned with the document as `suggestionReplies` (by
suggestion id). `POST /api/documents/:id/suggestions/:suggestionId/replies` adds one and
`DELETE /api/documents/:id/suggestions/:suggestionId/replies/:replyId` deletes one. Replies of
suggestions that no longer exist are not shown (they stay in the table, so undoing an accept
brings them back).

## Modes and display

The mode (`editing`, `suggesting`, `viewing`) is stored per document in localStorage
(`docs.mode.<documentId>`). Viewing mode and the review card's previews are display states:

- **Viewing** and **Preview accept all**: the editor is read-only, deleted text is hidden and
  inserted and formatted text is shown in its normal colours (CSS on the page stack). Viewing mode
  also hides comment highlights and the margin and disables the toolbar's editing controls and the
  Insert and Format menus.
- **Preview reject all**: read-only, inserted text hidden, deleted text shown normally. Formatting
  changes and paragraph breaks are still shown as suggested (a CSS preview cannot revert them).

While read-only, the dispatch hook drops any transaction that would change the document (except
accept/reject and synced steps), so menu commands cannot edit it. The pagination is laid out
again when the display state changes, because hidden text changes line breaks.

## Elsewhere

- **Headers, footers and footnotes** are edited directly in every mode except Viewing (their
  content is a document attribute edited in a second editor; suggestions there would need their
  own cards). Viewing mode does not open them.
- **Word export** writes insertions as `w:ins`, deletions as `w:del` with `w:delText`, text
  format changes as `w:rPrChange` holding the previous run properties, and suggested paragraph
  breaks as an inserted or deleted paragraph mark (`w:pPr/w:rPr/w:ins|w:del`) on the paragraph
  before the break. Paragraph format changes are exported with their new formatting only.
- **Word import** reads `w:ins` and `w:del` (`w:delText`) as suggestions with their author and
  date, `w:rPrChange` as text format suggestions and inserted or deleted paragraph marks as
  suggested breaks. Word gives every run its own revision, so adjacent revisions with the same
  author and date (with nothing else between them) become one suggestion: a deletion and the
  insertion replacing it, or an inserted paragraph mark and the text after it. Moves
  (`w:moveFrom`, `w:moveTo`) are read as deletions and insertions. Headers, footers and footnotes
  have no suggestions: their inserted text is kept and their deleted text left out.
- **Markdown, plain text and the server's search text** use the accepted result
  (`acceptedDocument`): deleted text is left out, inserted and formatted text is kept.
- **Word count, Find and the outline** read the accepted result too: deleted text is not counted,
  not matched and not shown in headings. A match on both sides of struck-through text spans it,
  so replacing that match replaces the struck-through text with it (as a suggestion in Suggesting
  mode).
- **Version history** shows suggestions with their styling, like the editor. The diff compares
  text, so a suggested deletion is not a change there until it is accepted. Restoring a version
  restores its suggestions.
