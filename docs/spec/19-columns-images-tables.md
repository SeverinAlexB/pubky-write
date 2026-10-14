# Columns, image wrapping, table extras (P1)

## Columns

- Format > Columns ▸ shows three icon presets (one, two, three columns; the
  current one outlined in primary colour) and "More options".
- "Column options" dialog (398px): three rows, each with the label at the
  left (14px) and its control right-aligned (controls 100px wide, 32px tall):
  "Number of columns" dropdown (1–3), "Spacing (centimetres)" number field
  (default 1.27), "Line between columns" checkbox; then Cancel / Apply.
- Columns apply to the whole document (the reference applies per section;
  sections are out of scope). Text flows down the first column to the bottom
  margin of the page, then continues at the top of the next column, then the
  next page (pagination must handle this). Optional vertical line between
  columns: 1px `#000000` full column height.
- Insert > Break > Column break (now enabled when columns > 1) forces the
  following content to the next column.
- Exports: Word sections with columns; print.

## Image wrapping and positioning

- The image pill's "Wrap text options" menu has, with icons and a check on the
  current mode: In line (default), Wrap text, Break text, Behind text, In
  front of text.
  - In line: the image is part of the text line (current behaviour).
  - Wrap text: the image floats at its position and text flows around it on
    both sides (if there is room ≥ 1 cm, otherwise on the wider side).
  - Break text: the image sits on its own lines; text is above and below,
    never beside.
  - Behind text / In front of text: the image is positioned freely on the page
    and text ignores it (drawn below or above the text).
- For every mode except In line the pill also shows:
  - a margin dropdown labelled e.g. "3.2mm margin" (options 0, 1.6, 3.2,
    6.4, 12.7 mm, and Custom…) — the gap between image and text;
  - a position dropdown: "Move with text" (default) or "Fix position on
    page".
- Non-inline images can be dragged to a new position; in Move with text mode
  the image stays anchored to the paragraph nearest to where it is dropped.
- Rotation: the rotation handle (11) works; Shift snaps to 15°. Stored in the
  document.
- Image options side panel (360px, title "Image options", "Close side sheet"
  ×) with collapsible sections: Size and rotation (width, height, lock aspect
  ratio, scale %, rotation angle), Text wrapping (the five modes + margin),
  Position (move with text / fix position, offsets from the anchor), Re-colour
  (No re-colour, Greyscale, Sepia; P2), Adjustments (transparency, brightness,
  contrast sliders), Alt text (title and description). Changes apply live and
  are undoable.
- Crop (P1): "Crop image" (toolbar, double-click the image) shows crop
  handles at the edges; dragging them trims the visible image; Enter or
  clicking outside applies, Escape cancels. Cropping is non-destructive
  (stored as insets).
- While an image is selected the toolbar shows "Image options" and "Replace
  image" text buttons after the image controls (11); Replace image ▸ Upload
  from computer / By URL keeps size and settings.
- Exports: Word anchors with wrap modes, rotation and crop; Markdown ignores
  them.

## Table extras

- Split cell (right-click or Format > Table): dialog "Split cell" (301px)
  with two number fields, "Columns" and "Rows" (with icons, default 1),
  Cancel / Split. Splitting divides the cell into the given grid; other cells
  of the row/column span to keep the table rectangular.
- Pin header row: right-click "Pin header row" pins the rows up to the
  current one ("Unpin header rows" when pinned). Pinned rows have a light grey
  background `#d9d9d9` (measured), repeat at the top of
  the table on every page the table continues to, and stay at the top when
  sorting.
- Insert title row: inserts an empty pinned row at the top.
- Set column type: omit (needs smart chips).

## Acceptance

- Choosing two columns flows text into two columns per page; the line between
  columns appears when enabled; a column break moves text to the next column.
- Wrap text makes paragraph text flow beside the image; Break text keeps text
  above and below; margin and position dropdowns change the layout; settings
  persist and export.
- Rotating and cropping persist after reload.
- Split cell 2 × 2 produces four cells; a pinned header row repeats on the
  next page.
