# Special characters and ruler dragging (P1)

## Insert special characters

Insert > Symbols > Special characters opens a non-modal dialog, 604 × 425px,
title "Insert special characters" with ×, placed near the bottom centre of the
editor so the cursor stays visible.

- Left part:
  - Two dropdowns in a row: category (Symbol, Punctuation, Emoji, Number,
    Latin, …) and subcategory (for Symbol: Arrows, Currency, Math, Shapes,
    Stars, Technical, …).
  - A scrolling grid of the characters in the chosen subcategory, each in a
    24px square cell; hovering shows a larger preview with the character name
    and code point (e.g. "U+2192 Rightwards arrow").
  - Clicking a character inserts it at the cursor; the dialog stays open.
- Right part:
  - A search field "Search by keyword (e.g. arrow) or code point" that filters
    across all categories (code points as "U+2192" or "2192").
  - Under it, a 180px square area "Draw a symbol here" (P2: handwriting
    recognition; may be omitted).
- Character data: use the Unicode character names (a bundled subset covering
  the listed subcategories is enough).

## Ruler dragging

- The left-indent, first-line-indent and right-indent markers on the
  horizontal ruler (01) can be dragged. While dragging, a vertical dotted
  guide line runs down the page at the marker's position and a small tooltip
  shows the value ("Left indent 2.54 cm").
- Values snap to 0.25 cm (en-GB) or 1/8 in (en-US); Alt disables snapping.
- Dragging the left-indent marker moves the first-line marker with it;
  dragging the first-line marker alone sets a first-line (or hanging) indent.
- The changes apply to all paragraphs in the selection and are stored as
  paragraph attributes (left indent, first-line indent, right indent in
  points). The existing indent levels from Tab/⌘] map onto the left indent.
- Margin areas on the ruler can be dragged to change the page margins (same
  as Page setup).

## Page setup dialog (amends 02)

The dialog (396px) has two tabs at the top: "Pages" (selected) and
"Pageless". Under Pages: "Apply to" dropdown ("Whole document"); Orientation
(Portrait / Landscape radios); "Paper size" dropdown showing e.g.
"A4 (21.0 cm x 29.7 cm)" next to "Page colour" (a swatch button opening the
colour palette); "Margins (centimetres)" with Top, Bottom, Left, Right fields
in one row; "Set as default" text button at the bottom left; Cancel and OK at
the bottom right. The Pageless tab shows a short description and switches the
document to pageless format on OK.

## Acceptance

- Searching "arrow" shows arrows; clicking one inserts it and the dialog stays
  open.
- Dragging the left-indent marker to 2 cm indents the paragraph by 2 cm,
  persisting after reload; the first-line marker can create a hanging indent.
- The Page setup dialog has the Pages/Pageless tabs and the page colour
  swatch; page colour applies to the pages and to export.
