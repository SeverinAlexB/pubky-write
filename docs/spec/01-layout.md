# Window layout (P1)

Measurements are for a 1440 × 900 window at 100% zoom.

## Vertical structure

| Band | Top | Height | Content |
| --- | --- | --- | --- |
| Header | 0 | 58px | Logo, title row, menu bar, header actions |
| Toolbar | 65 | 40px | Rounded toolbar container (see 03) |
| Horizontal ruler | 113 | 16px | Ruler aligned with the page |
| Editor area | 129 | rest | Vertical ruler, sidebars, pages, comments |

The whole window background is the surface colour; there is no visible line
between header and toolbar. The editor area scrolls; header, toolbar and ruler
stay fixed.

## Header

- **Logo** at the left (about 24 × 32px, 12px from the left edge), linking to
  the document list.
- **Title row** (top line, starting about 60px from the left):
  - The document title as an inline text field, 18px. It looks like plain text
    until hovered (1px outline) or focused (2px primary outline). Enter or
    blur saves; Escape reverts.
  - Right of the title: a **save status** icon (cloud). While saving it shows
    "Saving…"; after saving it shows "Saved to Drive" for a few seconds, then
    only the icon. In this app the text is "Saving…" and "Saved"; offline and
    error states keep their text visible.
- **Menu bar** (second line, directly under the title, about 46px from the
  top): File, Edit, View, Insert, Format, Tools. Labels are 14px with 7px
  horizontal padding and a rounded hover background.
- **Header actions** at the right, vertically centred in the header: a
  version history button (clock icon, 40px round) and a comments button
  (speech bubble icon, 40px round). There is no share button.

## Toolbar

See 03. The toolbar has a collapse control at its right end ("Hide the menus",
⌘⇧F) that hides the title row and menu bar to give more space. P2.

## Rulers (P1)

- A **horizontal ruler** 16px high spans the editor width. Its scale is aligned
  with the page: the zero point is the page's left margin, numbers count
  centimetres (en-GB) or inches (en-US) to the right, and negative numbers to
  the left margin edge. The margin areas of the ruler are shaded slightly
  darker than the writable area.
- Markers on the ruler show the current paragraph's left indent (a downward
  triangle with a small rectangle above it for the first-line indent) and right
  indent. Dragging markers is P2; showing them is P1.
- A **vertical ruler** 16px wide runs along the left edge of the editor area
  with the same scale for the page's vertical position.
- View > Show ruler toggles both rulers; the setting persists.

## Pages (P1)

- Paper size default: **A4** (210 × 297 mm = 794 × 1123px at 96 dpi) for
  en-GB and most locales; Letter (816 × 1056px) for en-US. Configurable in
  File > Page setup.
- Margins default to 2.54 cm (96px) on all sides.
- The editor shows **separate pages**: each page is a white rectangle with a
  1px `#c4c7c5` border, no shadow. Pages are separated by a **10px gap** of
  surface colour. The first page starts 16px below the ruler.
- Text flows from one page to the next: when a page's writable height is full,
  the next line continues at the top margin of the next page. Inserting a page
  break (Insert > Break > Page break, ⌘Enter) moves the following content to
  the next page.
- The page column is horizontally centred in the space between the left
  sidebar (if open) and the comments margin (if any).
- When comments exist, the page column shifts left to make room for the
  comment margin (see 06). At 1440px with no sidebar the page's left edge moves
  from x=276 to x=134 when comments are shown.

## Printing

Printing outputs only pages, with the page size and margins from page setup,
and without rulers, UI, comment highlights or the page border.

## Acceptance

- At 1440 × 900 the header, toolbar and ruler bands have the heights above.
- A new document shows one A4 page 794px wide with 96px margins.
- Typing more than a page of text creates a second page below a 10px gap, and
  the text continues at the top margin of page 2.
- ⌘Enter starts a new page.
- The ruler's 0 aligns with the left margin of the page.
