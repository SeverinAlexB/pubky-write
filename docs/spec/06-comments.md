# Comments (P1)

The app has a single local user. Show them as the author everywhere with a
display name (default "You", changeable in Tools > Preferences, P2) and a
32px round avatar showing the name's first letter on a coloured background.

## Comment margin

- When a document has at least one open comment (or a draft), a comment margin
  appears to the right of the page column, about 390px wide, and the page
  column shifts left to make room (01).
- Each thread is a card in the margin whose top is aligned with the top of the
  line containing the start of its commented text. If cards would overlap,
  later cards are pushed down so there is an 8px gap. The active card is placed
  exactly at its anchor and the others move around it (cards above may move
  up).
- Card width 389px (the margin width minus padding), radius 12px.
  - **Idle** card: background `#f1f4f8` (slightly darker than the `#f8fafd`
    surface), no shadow, 12px padding.
  - **Active** card: white, card shadow (09), shows the reply field and the
    header actions.
- Clicking a card makes it active; clicking commented text in the document
  makes its thread active. Clicking elsewhere makes no thread active.

## Commented text

- Commented text has a `#fcf2d1` background. The active thread's text has a
  `#f2bf42` background.
- Resolved threads have no highlight.

## Creating a comment

- With text selected, a small floating pill appears just right of the end of
  the selection (below the line), with two 32px icon buttons: "Add comment"
  and "Add emoji reaction" (P2). Pressing "Add comment", the toolbar button,
  Insert > Comment or ⌘+Option+M starts a draft.
- The draft card (active style) shows the avatar and name on the first row,
  then a rounded outlined field (radius 20px, focused) with the placeholder
  "Comment", then buttons "Cancel" (text) and "Comment" (filled pill; disabled
  while the field is empty).
- ⌘+Enter submits; Escape cancels.

## Thread card contents

- Header row: avatar, name (14px, medium weight) and, under it, the time
  (12px, secondary) as "16:26 Today", "16:26 Yesterday", or "13 Oct" for older.
- On the active card the header has, right-aligned, a "Mark as resolved and
  hide discussion" button (a check mark in primary colour) and a "More options"
  (⋮) button. The ⋮ menu has: Edit, Delete, Get link to this comment.
  - Edit turns the message into a field with Cancel and Save.
  - Delete asks for confirmation ("Delete this comment thread?") and removes
    the thread.
  - Get link copies a URL that opens the document with this thread active.
- Each message: body text 14px, preserving line breaks. Replies follow the
  first message with their own avatar, name and time; replies have their own ⋮
  (Edit, Delete) on hover.
- Below the messages on the active card: a rounded field with the placeholder
  "Reply"; typing reveals Cancel and Reply buttons.
- A thread whose text was deleted stays in the margin at the place where the
  text was, showing the quoted original text struck through under the label
  "Original content deleted" (italic, secondary).

## All comments panel

View > Comments > Show all comments (⌘+Option+Shift+A) or the header comments
button opens a 360px panel on the right titled "All comments" with a close
button and a filter ("All", "Open", "Resolved"; default Open). It lists threads
in document order as compact cards (quoted text with a yellow left bar, first
message, reply count). Clicking a card closes nothing, scrolls the document to
the text and activates the thread in the margin. Resolved threads can be
reopened from here.

## Acceptance

- Adding a comment shows its card beside the commented line, and the page
  shifts left.
- Two comments on lines far apart sit beside their lines; two comments on the
  same line stack with an 8px gap.
- The active card is white with a shadow; idle cards have no shadow.
- Commented text is `#fcf2d1`, and `#f2bf42` when active.
- Editing a comment's text via ⋮ > Edit persists after reload.
- Resolving hides the card and the highlight; the thread remains reachable in
  All comments under "Resolved".
- Selecting text shows the floating "Add comment" pill.
