# Everyday editing (P1)

## Link bubble

- When the cursor is inside a link (by clicking it or moving onto it with the
  keyboard), a card appears just below the link's line, left-aligned with the
  link's start: 324 × 67px, white, radius 8px, card shadow (09).
- Contents: a 16px site icon (the site's favicon from
  `https://<host>/favicon.ico`; a generic globe icon if it does not load),
  the page title in primary colour 14px (P2: fetched by the server from the
  page's `<title>`, cached; until known, or on failure, show the URL), the URL
  without the scheme in 12px secondary text under it, and at the right three
  32px round icon buttons: "Copy link", "Edit link" (opens the link dialog),
  "Remove link".
- The card disappears when the cursor leaves the link, on Escape, or while
  typing. Clicking the title opens the link in a new tab (links in the
  document itself are not opened by a plain click).
- Card accessible name: "Change or remove link."
- Preference "Show link details" (below) turns the card off.

## Preferences (Tools > Preferences)

A dialog 498px wide (09) with tabs "General" and "Substitutions"; Cancel and OK.

General (checkboxes, all on by default; stored per user):

- Automatically capitalise words — capitalises the first letter of a sentence
  (after the start of a paragraph or ". ", "! ", "? ") when the word is
  completed with a space or punctuation; also "i" → "I" as a word.
- Use smart quotes — " and ' become “ ” and ‘ ’ depending on position
  (opening after start/space/opening bracket, otherwise closing; apostrophes
  in words become ’).
- Automatically detect links — a typed URL or domain (e.g. `example.com`,
  `https://…`, `www.…`) becomes a link when followed by a space or Enter.
- Automatically detect lists — "1. ", "1) ", "a. ", "* ", "- " at the start of
  a paragraph start a numbered or bulleted list (preset matching the marker).
- Enable Markdown — `# ` … `###### ` at the start of a paragraph applies
  Heading 1–6; `**text**`, `*text*`, `~~text~~`, `` `text` `` apply bold,
  italic, strikethrough, code; `---` on its own line inserts a horizontal
  line.
- Automatically correct spelling — omit (no dictionary); do not show.
- Show Smart Reply suggestions — omit; do not show.
- Show link details — the link bubble above.
- Insert emoji using the colon character — typing `:` followed by letters
  shows a small emoji picker list filtered by name (e.g. `:smile`); Enter or
  click inserts the emoji (P2).

Every automatic change can be undone with ⌘Z immediately after it happens,
which restores what was typed.

Substitutions tab: a checkbox "Automatic substitution" (on), then a two-column
editable list "Replace" / "With" with a checkbox per row and a × "Remove"
button; an empty row at the top adds a new pair. Default pairs:

```
(c) ©    (r) ®    tm ™    c/o ℅    ... …
1/2 ½  1/3 ⅓  1/4 ¼  1/5 ⅕  1/6 ⅙  1/8 ⅛  2/3 ⅔  3/4 ¾
2/5 ⅖  3/5 ⅗  4/5 ⅘  5/6 ⅚  3/8 ⅜  5/8 ⅝  7/8 ⅞
<-- ←  <== ⇐  <=> ⇔  ==> ⇒  --> →  -- –  --- —
```

A substitution happens when the "Replace" text is completed by a space or
punctuation (or immediately for symbol sequences like `-->`).

## Keyboard shortcuts dialog (⌘+/)

- A modal dialog 600px wide (09), title "Keyboard shortcuts" with a "Close
  dialogue" × button; under the title a full-width pill search field
  "Search" that filters rows by name.
- Grouped sections with headers (e.g. "Text formatting", "Paragraph
  formatting", "Actions", "Navigation", "Menus", "Comments") listing every
  shortcut the app supports: name at the left (14px), keys at the right as
  small key caps (12px text, 1px `#747775` border, radius 4px, 2px 6px
  padding, 4px apart); alternatives joined by "or".
- The list is generated from the same shortcut definitions the app uses, so
  it never goes stale. It scrolls inside the dialog (max height 80% of the
  window).
- Also reachable from Help-like entry: Tools > Keyboard shortcuts.

## Paste

- Pasting HTML (from web pages, word processors, other documents) keeps
  structure and basic formatting: headings, paragraphs, lists (with nesting),
  tables, links, bold/italic/underline/strikethrough, superscript/subscript,
  images. It drops font families and sizes that equal the defaults, background
  colours on whole blocks, CSS classes, comments, scripts and unknown
  elements. Word-specific markup (mso-* styles, conditional comments, `o:p`)
  is cleaned.
- Pasted images that are remote URLs or data URLs are uploaded to the app's
  storage (as with Insert > Image) so documents never depend on external
  images; while uploading, a grey placeholder of the right size is shown.
- "Paste without formatting" (⌘+Shift+V) pastes plain text into the current
  formatting.
- Pasting a URL onto selected text turns the selection into a link.

## Offline and unsaved changes

- Edits not yet confirmed by the server are also kept in the browser
  (IndexedDB) per document. If the tab is closed, crashes or loses the
  connection, they are restored and sent the next time the document is
  opened (rebasing on newer server changes with the existing step protocol).
- While offline, the save indicator shows a cloud-off icon and the text
  "Offline – changes will be saved when you reconnect"; a dismissible
  snackbar "You're offline. Changes will be saved when you reconnect." appears
  once. On reconnect the pending edits are sent and the indicator returns to
  saved.
- If restoring pending edits fails (for example the document was deleted),
  show a dialog offering to download the unsaved text as a file.

## Acceptance

- Clicking inside a link shows the bubble with Copy / Edit / Remove; Remove
  unlinks; Escape hides it.
- Typing `"hi" -- (c) 1/2` gives `“hi” – © ½`; ⌘Z right after a substitution
  restores the typed text.
- Typing `1. ` at the start of an empty paragraph starts a numbered list;
  `* ` a bulleted list; `## ` Heading 2; `**bold**` bold.
- Typing `example.com ` creates a link.
- Each preference can be turned off and the behaviour stops; settings persist.
- ⌘+/ opens the shortcuts dialog; searching "bold" shows the Bold row with
  key caps ⌘ B.
- Pasting HTML from a word processor sample (fixture) keeps headings, lists
  and a table and drops mso styles; a pasted remote image is uploaded.
- Editing while the server is down, closing the tab and reopening after the
  server is back restores and saves the edits.
