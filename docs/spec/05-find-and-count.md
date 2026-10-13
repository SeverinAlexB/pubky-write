# Find, Find and replace, Word count (P1)

## Find bar (⌘F)

- ⌘F opens a floating card at the top right of the editor area: right edge
  about 28px left of the editor's right edge (left of the comment margin if
  any), top 0px below the ruler (y=113 at 1440 × 900), 408 × 72px, white,
  radius 12px, card shadow (09).
- Contents, left to right: an outlined text field with the floating label
  "Find in document" (about 210px wide) showing "N of M" right-aligned inside
  it once there is a query; then 32px round icon buttons: "Previous" (chevron
  up), "Next" (chevron down), "More options" (⋮), "Close" (×).
- Typing highlights all matches (`#ccedd2`) and the current match (`#87d392`)
  as you type; the current match is the first at or after the cursor and is
  scrolled into view.
- Enter = next, Shift+Enter = previous; wrapping around at the ends.
- Escape or Close hides the bar and removes the highlights; the current match
  stays selected in the document.
- "More options" opens the Find and replace dialog with the same query.
- If text is selected when ⌘F is pressed, the selection becomes the query.

## Find and replace dialog (⌘+Shift+H)

- A modal dialog centred over the editor, 396px wide, radius 28px, 24px
  padding. The document stays visible and matches stay highlighted behind the
  scrim.
- Title "Find and replace" with a "Close" (×) button at the top right.
- "Find" outlined field (floating label) with "N of M" inside on the right.
- "Replace with" outlined field.
- Three checkboxes with labels:
  - "Match case"
  - "Use regular expressions (e.g. \n for newline, \t for tab)" followed by a
    "Help" link (P2: opens a short help popover). With this on, the query is a
    JavaScript regular expression; `$1` in the replacement inserts groups.
    An invalid expression shows "0 of 0".
  - "Ignore diacritics (e.g. ä = a, E = É)" — checked by default; when on,
    letters match regardless of accents (compare after Unicode NFD and removing
    combining marks), still respecting "Match case".
- A row of buttons: "Replace", "Replace all", "Previous" as text buttons and
  "Next" as the filled primary button, right-aligned.
- Replace replaces the current match and moves to the next. Replace all
  replaces every match in one undo step.
- Matching never crosses paragraph boundaries unless a regular expression
  matches `\n` (P2).

## Word count (⌘+Shift+C)

- A modal dialog, 349px wide, radius 28px, title "Word count".
- A table of four rows separated by 1px dividers, label left and value right:
  "Pages", "Words", "Characters", "Characters excluding spaces". With a
  selection, values read "X of Y" (selection of total); Pages shows the page of
  the cursor "1 of 3".
- Below: a checkbox "Display word count while typing".
- Buttons "Cancel" (text) and "OK" (filled), right-aligned.
- When "Display word count while typing" is on (persisted per user), a small
  floating chip at the bottom left of the editor area shows "N words" (or
  "X of Y words" with a selection), updating live. Clicking it opens a menu to
  switch the displayed value (Words, Characters, Characters excluding spaces)
  or hide it.

## Acceptance

- ⌘F shows the card with a "Find in document" field; typing "item" in a text
  with four "item"s shows "1 of 4"; Enter moves to "2 of 4".
- ⌘+Shift+H opens the modal with the controls listed, in order, and "Ignore
  diacritics" checked; with it on, "cafe" finds "café".
- A regex query `(\w+)@x` with replacement `$1` replaces correctly.
- Word count shows the four rows and the live counter appears after enabling
  the checkbox and pressing OK.
