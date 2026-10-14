# Tables and images (P1)

## Inserting a table

Insert > Table opens a size picker: a grid of 18px cells (start with a 5 × 5
visible area that grows as you hover, up to 20 × 20). Hovered cells are filled
with the primary container colour and a label under the grid reads
"C x R" (columns × rows). Clicking inserts the table with the cursor in the
first cell. The toolbar has no table button.

## Table appearance

- Full content width, columns equally wide by default.
- Borders 1px solid black (`#000000`) on all cells.
- Cell padding 5pt (about 7px) on all sides; text top-aligned.
- No header styling by default ("Insert title row" adds a first row and pins
  it; P2 styling: none, the row is a normal row).
- Column widths can be changed by dragging the border between columns (a
  `col-resize` cursor appears on hover); widths are stored in the document.

## Table right-click menu

Right-clicking in a table shows the general context menu (see 12) with these
table items inserted after the clipboard group, separated by dividers:

- Insert row above, Insert row below, Insert column to the left, Insert
  column to the right
- —
- Delete row, Delete column, Delete table
- —
- Distribute rows, Distribute columns (make all rows/columns equal)
- Sort table ▸ (Sort ascending, Sort descending — by the column of the
  cursor, keeping the first row in place if it is pinned)
- Table options (opens the Table options panel)
- (Pin header row, Split cell, Set column type, Insert title row: P2)

## Format > Table submenu

Insert row above, Insert row below, Insert column left, Insert column right,
—, Delete row, Delete column, Delete table, —, Distribute rows, Distribute
columns, —, Merge cells, Unmerge cells (enabled for a multi-cell selection /
merged cell), —, Sort ascending, Sort descending, —, Table options.

## Table options panel (P2)

Opens as a right-side panel (360px, title "Table options" with a table icon
and ×). Sections: Table (column count, row count), Size (column width, minimum
row height), Alignment (left/centre/right, left indent), Colour (border
colour, border width, cell background). With the cursor outside a table it
shows "Select a table to see table options."

## Images

- Inserting: Insert > Image > Upload from computer / By URL, paste, or drag
  and drop (as today). Images are inline with text by default.
- Selecting an image (click) shows:
  - a 1px primary-colour outline with **8 square handles** (6px, primary
    fill, white 1px border) at the corners and edge midpoints, and a round
    rotation handle (8px) on a short stem above the top edge (rotation P2);
  - dragging a corner handle resizes keeping the aspect ratio; edge handles
    stretch one dimension; Shift keeps the ratio on edges too. Size is stored
    in the document (width/height attributes);
  - a **floating pill** 8px below the image's bottom-left: "Wrap text options
    ▾" (In line with text (default), Wrap text (P2), Break text (P2)), "Image
    options" (opens a side panel, P2: size, rotation, alt text), "Add comment",
    "Add emoji reaction" (P2).
- While an image is selected, the toolbar replaces the text-formatting
  controls (Styles through Highlight colour and the alignment group stays) with
  image controls: "Border colour", "Border weight", "Border dash" (P2 each) and
  "Crop image" (P2). Show them disabled until implemented.
- Delete/Backspace removes a selected image. Alt text (P2) is editable in
  Image options.

## Acceptance

- The size picker shows "3 x 2" when hovering the third column of the second
  row and inserts that size.
- Tables have black 1px borders and 7px cell padding and fill the content
  width.
- Dragging a column border changes the widths, and they persist after reload.
- Right-click in a table shows the table items; Sort ascending sorts rows.
- A selected image shows eight handles and the floating pill; dragging a
  corner resizes proportionally and persists after reload.
