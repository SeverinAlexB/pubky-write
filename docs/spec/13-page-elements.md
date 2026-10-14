# Headers, footers, page numbers, footnotes, table of contents (P1)

All of these only show in print layout (01). They are stored in the document
and exported to Word.

## Headers and footers

- Insert > Page elements > Header (shortcut chord Ctrl+⌘O then Ctrl+⌘H) and
  Footer (Ctrl+⌘O then Ctrl+⌘F), or double-clicking the top/bottom margin
  area of a page, opens the header (footer) for editing.
- The header area starts 1.27 cm (48px) from the top edge of the page; the
  footer area ends 1.27 cm from the bottom edge. Their text uses Normal text
  style. If header content is taller than the space above the top margin, the
  body content moves down.
- While editing a header: the body text is shown at reduced opacity (about
  50%); a 1px `#c4c7c5` horizontal line runs under the header area across the
  page with, on it, the label "Header" at the left (12px, secondary, white
  background) and at the right a checkbox "Different first page" and an
  "Options" text button (menu: Header format… (P2), Page numbers…, Remove
  header). The footer is the same with the line above its area and the label
  "Footer".
- The same header and footer appear on every page (except page 1 if
  "Different first page" is checked, which gives page 1 its own header and
  footer).
- Escape, or clicking in the body, ends header/footer editing.
- Headers and footers support normal character formatting, alignment and page
  number fields.

## Page numbers

- Insert > Page elements > Page numbers ▸ shows four icon presets in a 2 × 2
  grid: number in the header at the right on all pages; header right skipping
  the first page; footer right on all pages; footer right skipping the first
  page. Then "More options" and "Page count".
- "Page count" inserts a field showing the total number of pages at the
  cursor.
- More options opens "Page numbers" (dialog, 304px): Position (radio: Header,
  Footer), checkbox "Show on first page", Numbering (radio "Start at" with a
  number field, default 1; "Continue from previous section" disabled), Cancel
  and Apply.
- Page number fields update as pagination changes.

## Footnotes

- Insert > Page elements > Footnote (⌘+Option+F) inserts a superscript
  footnote number at the cursor and moves the cursor to the footnote text at
  the bottom of the same page.
- Footnotes at the bottom of a page: a 1px black separator line about one
  third of the text width (192px on A4), 8px above the first footnote; each
  footnote is "<superscript number> text" in 10pt. Footnote numbers run 1, 2,
  3… through the document in order of their reference and renumber
  automatically.
- Footnote space is taken from the page's writable height (pagination must
  account for it).
- Deleting the reference number deletes the footnote.

## Table of contents

- Insert > Page elements > Table of contents ▸ shows three icon presets:
  1. "Plain text": each heading as a line with its page number right-aligned
     (black text).
  2. "Dotted": the same with a dotted leader between text and number.
  3. "With blue links": headings as blue underlined links, no page numbers.
- The table of contents lists Heading 1–6 (and Title) with 0.5 in more indent
  per level below the highest level. It is one block; clicking an entry in
  the linked style jumps to the heading.
- It does not update automatically: when the cursor is in it, a small pill
  with a refresh icon ("Update table of contents") and a ⋮ (Delete table of
  contents) appears at its top-left.

## Acceptance

- Adding a header shows it on every page; "Different first page" leaves page
  1 empty; it persists after reload.
- A footer with page numbers shows 1, 2, 3 on consecutive pages.
- Two footnotes on one page show at its bottom with numbers 1 and 2;
  inserting a footnote before them renumbers to 1, 2, 3.
- Inserting each table of contents preset shows the headings with page
  numbers (presets 1–2) or links (preset 3); "Update" refreshes it after a
  heading is renamed.
