# Suggesting mode (P1)

Suggestions are proposed edits that are visible in the document and only
become real when accepted. This app has one user, but suggestions are still
useful to review one's own changes; the author is shown as "You" with the same
avatar as comments (06).

## Modes

- The **mode button** is at the right end of the toolbar (before the "Hide the
  menus" chevron): an icon (pencil for Editing, a pencil-in-box for Suggesting,
  an eye for Viewing) with a ▾. In Suggesting mode the button has the primary
  container background.
- It opens a menu (and View > Mode ▸ has the same entries) with three items,
  each with an icon, a title and a one-line description, and a check mark on
  the current mode:
  - Editing — "Edit document directly"
  - Suggesting — "Edits become suggestions"
  - Viewing — "Read or print final document"
- Switching to Suggesting shows a dark snackbar "You're suggesting" at the
  bottom left of the window for 4 seconds (snackbar: `#323232` background,
  white 14px text, radius 4px, at least 288px wide, 48px tall, 16px from the
  window's left and bottom edges). Shortcut: ⌘+Option+Shift+X toggles
  Suggesting / Editing; ⌘+Option+Shift+Z sets Editing (P2: also Viewing via
  ⌘+Option+Shift+C).
- Viewing mode: the document is read-only, shows the result as if all
  suggestions were accepted, hides comment highlights and suggestion styling,
  and the toolbar's editing controls are disabled.
- The mode is remembered per document per user (localStorage).

## Making suggestions (Suggesting mode)

- **Inserted text** is shown in the suggestion colour `#35713a` (measured; a
  dark green) without other decoration.
- **Deleting** text does not remove it; it is shown in the suggestion colour
  with a strike-through. Deleting text that is itself a pending insertion by
  the same user removes it directly.
- **Formatting changes** (bold, italic, underline, strike-through, colours,
  font, size, paragraph style, alignment, lists) are applied and shown, with
  the affected text in the suggestion colour; the card describes them.
- Consecutive typing and deletions at the same place form **one suggestion**.
  A new suggestion starts after the cursor moves away or after 2 minutes of
  inactivity.
- When a suggestion's card is active, its text in the document gets a 1px
  border in the suggestion colour (radius 2px) around the affected range.
- Suggestions are stored in the document and are saved, synced, exported and
  versioned like other content. Word export writes them as tracked changes
  (insertions and deletions; formatting changes as format revisions where
  possible); Word import reads tracked changes as suggestions.

## Suggestion cards

- Each suggestion gets a card in the comment margin (06), aligned and stacked
  like comment cards (comments and suggestions share the margin).
- Card contents: avatar, "You", time ("11:53 Today"), then a description in
  14px:
  - Add: “<inserted text>” (the quoted text in italics, truncated to about 50
    characters with "…")
  - Delete: “<deleted text>”
  - Replace: “<deleted>” with “<inserted>” (a deletion directly followed by an
    insertion)
  - Format: <list of changes, e.g. "bold, font"> (and for list items also a
    line "Format bullet: …")
- The suggestion being made becomes the **active card** automatically: right
  after typing, deleting or formatting in Suggesting mode, the card of that
  suggestion is active (white, accept/reject visible, its text bordered) for
  as long as the cursor stays in or next to it.
- The active card is white with a shadow and shows, in the header row at the
  right, "Accept suggestion" (a check mark, primary colour) and "Reject
  suggestion" (×) icon buttons, plus the "Reply" field (replies are stored as
  comment replies on the suggestion).
- Accepting applies the change permanently (inserted text becomes normal text,
  deleted text is removed, formatting stays); rejecting reverts it (inserted
  text is removed, deleted text returns to normal, formatting reverts). The
  card disappears. Both are one undo step.

## Review suggested edits

Tools > Review suggested edits (Ctrl+⌘O then Ctrl+⌘U) opens a floating card
under the toolbar at the right (408px wide, like the find bar) with:

- Title "Suggested edits", then "Previous" (chevron up) and "Next" (chevron
  down) icon buttons that select the previous/next suggestion and scroll to it,
  and "Close" (×).
- A full-width outlined dropdown (40px tall, radius 4px, 14px text, ▾ at the
  right) showing the current view: "Show suggested edits", "Preview accept
  all", "Preview reject all" (the previews show the document as if all were
  accepted/rejected, read-only, without suggestion styling).
- A right-aligned row with two split buttons, 36px tall with 14px text (the ▾
  part 28px wide, separated by a 1px divider): "Reject" (outlined) with "More reject options"
  ▾ (menu: "Reject all (N)") and "Accept" (filled) with "More accept options"
  ▾ (menu: "Accept all (N)"). Reject/Accept act on the selected suggestion
  and move to the next.

## Acceptance

- Switching to Suggesting shows "You're suggesting"; typing " suggested"
  shows green text and a card "Add: “suggested”".
- Deleting "Second item" in Suggesting mode keeps it visible, struck through
  in green, with a card "Delete: “Second item”".
- Bolding text in Suggesting mode creates a "Format: bold" card.
- Accepting the insertion leaves black text and removes the card; rejecting
  the deletion restores normal text.
- Review suggested edits: Next moves between suggestions; "Accept all (3)"
  applies all three in one undo step.
- Suggestions survive reload; Viewing mode shows the accepted result
  read-only.
- Word export/import round-trips insertions and deletions as tracked changes.

## Structural suggestions (amendment, round 4)

In Suggesting mode these edits also become suggestions instead of being
applied directly:

- **Inserting** an image, table, page break, column break, horizontal line,
  table of contents, footnote, or a list (turning paragraphs into a list):
  the inserted object is shown with a 2px dashed outline in the suggestion
  colour (text inside an inserted table or footnote is shown as inserted
  text). Card: "Add: Image", "Add: Table", "Add: Page break", "Add: Column
  break", "Add: Horizontal line", "Add: Table of contents", "Add: Footnote",
  "Format: bulleted list" / "Format: numbered list".
- **Deleting** any of these objects keeps them visible with a 50% opacity
  overlay striped in the suggestion colour (images, tables) or struck through
  (breaks, lines); card "Delete: Image", etc.
- **Table structure**: inserting or deleting rows and columns becomes a
  suggestion (inserted rows/columns outlined, deleted ones struck through).
  Cell merges and splits are applied directly (not suggestions).
- **Image changes** (size, wrap mode, rotation, crop) become "Format: image"
  suggestions; rejecting restores the previous values.
- **Headers, footers and footnote text**: edits made while in Suggesting mode
  become suggestions there too, with their cards shown in the comment margin
  next to the header/footer/footnote area while it is being edited, and in
  Review suggested edits at all times.

Accepting or rejecting works as for text suggestions; Accept all / Reject all
include these. Word export writes inserted/deleted tables, rows and images as
tracked changes where the format allows.

### Acceptance

- In Suggesting mode, inserting an image shows a dashed outline and an "Add:
  Image" card; rejecting removes the image.
- Deleting a table row in Suggesting mode strikes it through with a "Delete:
  Table row" card; accepting removes the row.
- Typing in the header in Suggesting mode produces a suggestion with a card;
  accepting it makes it normal header text.

## Amendment (round 5)

- "Preview reject all" also shows suggested formatting, paragraph changes and
  image changes reverted (the preview renders the rejected result, not just
  hidden insertions).
