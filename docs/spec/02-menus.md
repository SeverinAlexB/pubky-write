# Menu bar (P1)

## Behaviour

- Clicking a menu label opens its menu below the label; the label gets a
  rounded highlight. While one menu is open, hovering another label switches to
  it. Escape or a click outside closes the menu.
- Items have an optional leading icon column (18px), the label, and a
  right-aligned shortcut in secondary text. Items with a submenu show a small
  right-pointing triangle instead of a shortcut; hovering (or →) opens the
  submenu to the right, aligned with the item.
- Disabled items are shown in 38% opacity and cannot be chosen (for example
  Cut and Copy without a selection).
- Toggle items (such as Show ruler) show a check mark in the icon column when
  on.
- Keyboard: ↑/↓ move, → opens a submenu, ← closes it, Enter chooses.
- Shortcuts are shown with Mac symbols on macOS (⌘, ⌥ as "Option", ⇧ as
  "Shift") and as Ctrl+… elsewhere, written like "⌘+Shift+H".

## Contents

Items marked *(omit)* depend on services this app does not have and must not
be shown. "—" is a separator.

### File

- New ▸ — Document; From template gallery *(omit)*
- Open ⌘O — goes to the document list
- Make a copy — creates "Copy of <title>" and opens it
- —
- Share ▸ *(omit)*, Email ▸ *(omit)*
- Download ▸ — Microsoft Word (.docx); PDF document (.pdf); Plain text (.txt);
  Web page (.html, zipped) *(P2)*; Markdown (.md). Omit formats the app cannot
  produce.
- —
- Rename — focuses the title field
- Move *(omit)*, Add a shortcut to Drive *(omit)*
- Move to bin — deletes after confirmation, returns to the document list
- —
- Version history ▸ — Name current version (P2); See version history
  ⌘+Option+Shift+H
- Make available offline *(omit)*
- —
- Details — dialog with created, modified, word count summary (P2)
- Language ▸ *(omit)*
- Page setup — dialog (see below)
- Print ⌘P

### Edit

- Undo ⌘Z
- Redo ⌘Y (⌘+Shift+Z also works)
- —
- Cut ⌘X, Copy ⌘C (disabled without a selection)
- Copy as Markdown (disabled without a selection)
- Paste ⌘V, Paste without formatting ⌘+Shift+V, Paste from Markdown
- —
- Select all ⌘A
- Delete (disabled without a selection)
- —
- Find and replace ⌘+Shift+H

### View

- Mode ▸ — Editing, Viewing (Suggesting *(omit)*). Viewing makes the document
  read-only until switched back. P2.
- Comments ▸ — Hide comments ⌘+Option+Shift+J; Show all comments
  ⌘+Option+Shift+A (opens the all-comments panel, see 06)
- Expand tabs and outlines sidebar (shortcut Ctrl+⌘A Ctrl+⌘H as a chord, P2)
- —
- Show print layout (toggle; off = pageless continuous view, P2)
- Show ruler (toggle)
- Show non-printing characters ⌘+Shift+P (toggle, P2)
- —
- Full screen (P2)

### Insert

- Image ▸ — Upload from computer; By URL
- Table ▸ — a size grid picker (hover over up to 20 × 20 cells; the label
  under the grid shows "C x R"; click inserts)
- Link ⌘K
- Symbols ▸ — Special characters (P2), Equation *(omit)*, Emoji (P2)
- —
- Horizontal line
- Break ▸ — Page break ⌘+Enter
- Bookmark *(omit)*
- Page elements ▸ — Table of contents (P2), Header, Footer, Page numbers,
  Footnote ⌘+Option+F (all P2)
- —
- Comment ⌘+Option+M

### Format

- Text ▸ — Bold ⌘B; Italic ⌘I; Underline ⌘U; Strikethrough ⌘+Shift+X;
  Superscript ⌘.; Subscript ⌘,; — ; Size ▸ (Increase font size ⌘+Shift+.,
  Decrease font size ⌘+Shift+,); Capitalisation ▸ (lowercase, UPPERCASE,
  Title Case)
- Paragraph styles ▸ — Normal text, Title, Subtitle, Heading 1 … Heading 6,
  then a separator and "Options ▸" (P2). Entries here are **plain menu text in
  the normal menu font, not previews** (previews are only in the toolbar's
  Styles dropdown, see 03). Each entry has a submenu "Apply '<style>'".
- Align and indent ▸ — Left ⌘+Shift+L; Centre ⌘+Shift+E; Right ⌘+Shift+R;
  Justified ⌘+Shift+J; — ; Increase indent ⌘+]; Decrease indent ⌘+[;
  Indentation options (P2 dialog)
- Line & paragraph spacing ▸ — Single; 1.15; 1.5; Double; — ; Add space
  before paragraph / Remove space before paragraph; Add space after paragraph /
  Remove space after paragraph; — ; Custom spacing… (dialog); — ; Keep with
  next, Keep lines together, Prevent single lines, Add page break before
  (toggles, P2). The current line spacing has a check mark.
- Bullets and numbering ▸ — Numbered list menu ▸, Bulleted list menu ▸,
  Checklist menu ▸ (the same preset grids as the toolbar, see 03)
- —
- Page orientation (P2), Switch to pageless format (P2)
- —
- Table ▸ (enabled inside a table): Insert row above/below, Insert column
  left/right, Delete row, Delete column, Delete table
- —
- Clear formatting ⌘\

### Tools

- Spelling and grammar ▸ *(omit; the browser's spell check is used)*
- Word count ⌘+Shift+C
- Dictionary, Translate document, Voice typing, Citations *(omit)*
- Preferences (P2: toggles for automatic substitutions and smart quotes)

## Page setup dialog

Title "Page setup". Fields: Orientation (Portrait/Landscape radio buttons);
Paper size (dropdown: A4, Letter, Legal, A5, A3); Page colour (P2); Margins in
centimetres (en-GB) or inches: Top, Bottom, Left, Right (default 2.54 cm);
buttons Set as default (P2), Cancel, OK. Settings are stored per document.

## Acceptance

- Every P1 item above exists, in the listed order, with its shortcut text, and
  performs its action.
- Omitted items do not appear.
- Submenus open on hover and with →; Escape closes.
- Page setup changes the page size and margins of the open document and
  persists after reload.
