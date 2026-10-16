# Design: image wrapping, positions, rotation and crop

Our own design for the image parts of spec 19.

## Data model

Images stay block leaf nodes (`image`). New attributes, each with a default and a `validate`
function (`shared/src/images.ts`), so documents saved before them show images in line with text and
stored steps apply unchanged:

| Attribute | Meaning | Default |
| --- | --- | --- |
| `wrap` | `inline`, `wrap` (Wrap text), `break` (Break text), `behind`, `front` | `inline` |
| `wrapMargin` | Space between the image and the text, in points (presets 0, 1.6, 3.2, 6.4, 12.7 mm) | 9 (3.2 mm) |
| `positioning` | `moveWithText` or `fixed` (Fix position on page) | `moveWithText` |
| `offsetX`, `offsetY` | Offsets in CSS pixels, see below | 0 |
| `rotation` | Degrees, 0–359, clockwise | 0 |
| `crop` | `null` or `{ top, right, bottom, left }`: the fraction of the whole picture trimmed off each edge | `null` |
| `recolor` | `null`, `greyscale` or `sepia` | `null` |
| `transparency`, `brightness`, `contrast` | Percent: 0–100, −100–100, −100–100 | 0 |
| `title`, `alt` | Alt text title and description (the image extension's own attributes) | `null` |

`width` and `height` stay the size shown on the page. With a crop that is the size of the visible
part; the whole picture is `width / (1 − left − right)` wide. Cropping never changes the uploaded
file.

### Anchors

An image that is not in line with text is **anchored to the block after it**: the image node sits
right before its anchor in the document. That is where Word anchors a drawing too (in the paragraph
it belongs to), so it needs no extra reference that steps would have to keep valid, and the image
moves with that paragraph when text is added above it. Moving an image (dragging it) is one undo
step that deletes the node and inserts it before the new anchor.

| Positioning | `offsetX` from | `offsetY` from |
| --- | --- | --- |
| Move with text | the column's left edge | the anchor's top (Break text: where the image starts, below its margin) |
| Fix position on page, Wrap or Break text | the column's left edge | the top of the anchor's page |
| Fix position on page, Behind or In front of text | the page's left edge | the top of the anchor's page |

Wrapped and breaking images keep their horizontal offset from the column, because they are part of
the text's flow in that column. Offsets of wrapped and breaking images are never negative.

## Layout on the paginated pages

Everything is CSS on the image's frame (`imageFrameStyle`), so the pagination keeps measuring
blocks and lines as before:

- **In line**: a block, as before.
- **Break text**: a block with the margin above and below and `offsetX` as its left margin.
- **Wrap text**: where the text goes depends on the room beside the image in its column
  (`wrapSide`): on both sides when each side has at least 1 cm of free text width beyond the wrap
  margin, otherwise on the wider side. The side needs the image's width and its column's width; the
  node view works it out once the frame is on the page and the picture has loaded (and again before
  every layout, as the column can get narrower), and switching away from In line stores the size
  shown. The frame's `data-wrap-side` is `left`, `right` or `both`.
  - **One side**: a CSS float at its anchor, with `offsetY` as its top margin and the wrap margin on
    the text's side. The image floats to the side with less room and the text takes the wider side.
    Floating right, the right margin is `calc(100% − offsetX − width)`, so the offset still counts
    from the left.
  - **Both sides**: CSS has no float with text on both sides (exclusions never shipped), so the
    image takes no room in the text at all (`position: absolute` at its static position, moved by
    its offsets, like an image in front of text) and the lines beside it make room for it. Every
    such line gets a **gap**, an inline-block widget decoration as wide as from where the line's
    text would reach the image (minus the margin) to the image's right edge plus the margin. The
    gap goes before the first word that would touch the image, so a line reads its left part, then
    its right part, and the words after the gap wrap as usual. Blocks other than text (tables,
    images in line or breaking text, lines) that would be beside the image start below it, after a
    block widget of the missing height. An absolute image rather than a float with no width:
    Chrome takes a float beside a line as that line's start, so a click or ⌘← at the start of a
    line beside it selected the image.

    The gaps depend on how lines break, so they are measured (`imageWrap.ts`). Before the
    pagination measures, it lays the gaps out: with the content flat (one column, no spacers, no
    gaps; the same flat layout the pagination measures with columns), every textblock that is
    beside an image is replaced by a copy (the original gets a class that hides it), and gaps are
    added to the copy one line at a time, each where the first character that touches the image is,
    since each gap changes how the rest of the paragraph wraps. A line whose text after its gap
    still touches the image (centred or justified lines move when a gap is added) gets a wider gap,
    and one whose text before the gap does gets the gap a word earlier. The copies stay in place
    while the blocks below are measured, so those see the lines above as they will be. Then the
    copies are removed (ProseMirror's DOM observer is stopped meanwhile), and the gaps found become
    widget decorations at the positions of the copies' text; nothing is painted in between. The
    gaps are only measured again when the layout runs, and only for documents that have such an
    image (otherwise the step costs one query).

    Headers and footers can hold images too (pasted, or from Word files). Their editor uses the
    same node view and gaps, laid out after every change by the gap plugin itself (it has no
    pagination). The copies of a header or footer on the pages are static HTML: there the side is
    worked out from the region's width and the gaps and moved blocks are put into that HTML
    directly (`layOutStaticWraps`), also where the pagination measures how tall the region is.
- **Behind text / In front of text**: `position: absolute` with its static position (where the
  anchor starts) moved by margins, `z-index: -1` or `3` inside the page content, which is its own
  stacking context (`isolation: isolate`), so behind is still above the page sheet. A press on a
  behind-text image where there is no character selects it.
- Rotation is a `transform` on the frame (the handles turn with it); re-colour, brightness and
  contrast are CSS filters and transparency is opacity on the picture.
- A crop is a box of the visible size with `overflow: hidden`; the picture inside is scaled and moved
  by percentages of that box, so the crop survives resizing.

### Pagination

- Wrapped images are layout boxes like blocks: a wrapped image that does not fit at the bottom of a
  page moves to the next page together with its anchor (the spacer goes before the image).
- Breaking images are blocks.
- Behind and in front of text are not layout boxes: they take no room and may hang over a margin.
- **Fix position on page** needs the page of the anchor, which only the pagination knows. Before
  measuring, it sets a CSS variable on each fixed image (`imagePlacement.ts`): `--image-page-top`
  (the page's top, for absolute images) or `--image-page-shift` (page top minus where the anchor
  starts, added to a float's or breaking image's top margin). The node view keeps those variables
  when it redraws the frame.

The version history preview and Preview reject all use the editor's node view (read-only), so they
lay images out as the editor does, text on both sides included. `renderHTML` writes a frame with the
same styles for images with a layout of their own, for copy and paste within the editor (which keeps
the attributes as `data-` attributes) and for the static copies of headers and footers; without the
editor's width it floats wrapped images left, and the copies of headers and footers then work out
the side themselves (below).

## Interaction

- **Drag**: pressing on a placed image and moving more than 4px drags it (a transform while
  moving). On release, the anchor is the top-level block under the image's new top edge (in the
  pointer's column), or the nearest block above. Images in line with text are still dragged by the
  editor (move between blocks).
- **Rotate**: the round handle; the angle is from the frame's centre to the pointer, 0° straight
  up; Shift rounds to 15°.
- **Crop**: Crop image on the toolbar or a double-click (the browser's `dblclick`) starts crop mode
  for the selected image (plugin state with a node decoration the node view reacts to). The whole
  picture shows dimmed, the visible part bright with eight black crop handles. Enter or a press
  outside the image (the image losing its selection) applies; Escape cancels. Applying stores the
  crop and the new visible size, and moves a placed image's offsets so the visible part stays where
  it was.
- **Image options** (360px side panel): collapsible sections; number fields apply on Enter or when
  they lose focus, sliders while they move (one undo step per drag).
- **Replace image**: uploads or takes a URL and changes only `src`.
- In Suggesting mode inserting and deleting an image, and every change of its attributes above
  (except dragging it to another paragraph), are suggestions (see [suggesting.md](suggesting.md)).

## Exports and import

- Word: images that are not in line become anchored drawings (`wp:anchor`) in the paragraph after
  them, or a paragraph of their own: `wrapSquare` (`wrapText="bothSides"` where the editor puts text
  on both sides, from the image's width and its column's, otherwise `largest`), `wrapTopAndBottom`, or `wrapNone` with
  `behindDoc` for behind text; `distT/B/L/R` from the margin; positions relative to the column and
  paragraph, or to the page; rotation in `a:xfrm`; crop as `a:srcRect`. In line images keep rotation
  and crop. Transparency, brightness, contrast and re-colour are left out.
- Word import reads the same: anchored drawings become placed images before their paragraph
  (every `wrapSquare`, `wrapTight` or `wrapThrough` is Wrap text, whose side the editor works out from the room
  there is, so a `largest`, `left` or `right` wrap with room on both sides shows text on both),
  positions from the margins become positions from the column or the page, and inline drawings keep
  their rotation and crop.
- Markdown and plain text ignore all of it.

## Known limits

- With text on both sides of an image, the gaps are measured without the page breaks: a line that
  would be beside the image but moves to the next page or column (the image fits, the line does not)
  keeps its gap there. Images in headers and footers can be selected and resized, but their
  wrapping is only set by Word files (the image pill is the body's). Text inside table cells beside
  the image is not split: the table moves below the image. A word wider than both sides of a line
  moves below the image, leaving the lines beside it empty.
- An image is anchored to a top-level block: dropped into a list or a table, it anchors to the
  whole list or table.
- Behind-text images can be pressed only where there is no text over them (or selected with the
  arrow keys).
- Word's colour adjustments (`a:lum`, `a:grayscl`, `a:alphaModFix`) are not exported or imported.
