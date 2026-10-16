# Document list (P1)

Measurements at 1440 × 900.

## Header (64px, white)

- Left: a 48px round "Main menu" button (hamburger icon; P2: opens a drawer
  with links to the document list and Preferences), then the app logo and the
  name "Pubky Write" (22px, secondary text colour).
- Centre: a search pill about 720px wide, 48px high, radius 24px, background
  `#f1f4f8` (focused: white with the card shadow), a search icon at the left,
  placeholder "Search", and a "Clear search" × at the right while it has text.
  Search filters by title and content as today.
- No account controls.

## "Start a new document" band

- Background `#f1f4f8`, full width, from the header (y=64) to y=380 (316px
  tall); content centred in a column about 1000px wide.
- A header row: "Start a new document" (16px, medium) at the left; at the right
  a "Template gallery" text button with an expand/collapse ⇕ icon and a ⋮
  button (P2: "Hide all templates").
- A row of tiles, 18px apart: each tile is a 144 × 186px white page preview
  with a 1px `#dadce0` border (radius 4px, primary-colour border on hover),
  followed by the name (14px, medium) and a subtitle (12px, secondary).
  - First tile "Blank document": a large multicolour-free plus sign (use the
    primary colour) on white.
  - Then templates provided by this app (P2): "Letter", "Resume", "Project
    proposal", "Report", each creating a new document from a built-in
    template. Template previews are rendered thumbnails of the template.
- "Template gallery" toggles between this single row and an expanded view
  with all templates (P2).

## Recent documents

- Header row (centred column, about 1000px): the title at the left
  ("Recent documents"; in list view grouped by date instead), then at the
  right: an "Owned by anyone ▾" dropdown (single user: options "Owned by
  anyone", "Owned by me" — both show all documents), a view toggle button
  ("List view" / "Grid view"), a "Sort options" button (A→Z icon) and an "Open
  file picker" button (folder icon, see Import).
- Sort options menu: "Last opened by me", "Last modified by me", "Last
  modified", "Title" with a check mark on the current one. Persisted.

### Grid view (default)

- Tiles 208px wide plus a 1px border on each side, with 20px gaps (5 per row
  at 1440px).
- Each tile: a thumbnail 208 × 268px showing the top of the document's first
  page (rendered at reduced scale, white, 1px `#dadce0` border, radius 4px
  at the top), then a footer area: the title (14px, medium, single line with
  ellipsis), and a row with the document icon (16px, primary blue), the date
  label ("Opened 06:58" for today, "Opened 7 Oct 2026" otherwise; or
  "Modified …" when sorted by modification), and a ⋮ "More actions" button.
- Hovering a tile shows a primary-colour border.

### List view

- Rows grouped under date headings: "Today", "Previous 7 days", "Previous 30
  days", "Earlier" (12px, medium, secondary).
- Each row (48px): document icon, title, owner column ("me"), date column
  ("Last opened by me" header label shows which date), and ⋮.
- Column header row showing the current sort label.

### Tile/row menu (⋮)

"Rename", "Remove", "Open in new tab". ("Available offline" is omitted.)
Remove asks for confirmation.

## Import (P1)

The "Open file picker" button opens a dialog "Open a file" with an "Upload"
tab: a drop zone ("Drag a file here" with a "Browse" button) accepting .docx
and .md files. The file is converted into a new document (headings, paragraph
styles, bold/italic/underline/strikethrough, links, lists, tables, images,
page breaks) and opened. Unsupported content is dropped with a short notice.

## Acceptance

- Header, template band and grid tiles have the sizes above at 1440px.
- The view toggle switches between grid and grouped list and persists.
- Sort options and the owner filter work and persist.
- Uploading a .docx with headings, a list and a table creates a document with
  the same structure; uploading a .md does the same.
