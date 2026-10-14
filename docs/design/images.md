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
- **Wrap text**: a CSS float at its anchor, with `offsetY` as its top margin and the wrap margin on
  the text's side. CSS floats have text on one side only, so the image floats to the side with less
  room and the text takes the wider side (spec: "otherwise on the wider side"). Floating right, the
  right margin is `calc(100% − offsetX − width)`, so the offset still counts from the left. The
  side needs the image's width and its column's width; the node view works it out once the frame is
  on the page and the picture has loaded, and switching away from In line stores the size shown.
- **Behind text / In front of text**: `position: absolute` with its static position (where the
  anchor starts) moved by margins, `z-index: -1` or `3` inside the page content, which is its own
  stacking context (`isolation: isolate`), so behind is still above the page sheet. A press on a
  behind-text image where there is no character selects it.
- Rotation is a `transform` on the frame (the handles turn with it); re-colour, brightness and
  contrast are CSS filters and transparency is opacity on the picture.
- A crop is a box of the visible size with `overflow: hidden`; the picture inside is scaled and moved
  by percentages of that box, so the crop survives resizing.

### Pagination

- Wrapped images are layout boxes like blocks: a float that does not fit at the bottom of a page
  moves to the next page together with its anchor (the spacer goes before the image).
- Breaking images are blocks.
- Behind and in front of text are not layout boxes: they take no room and may hang over a margin.
- **Fix position on page** needs the page of the anchor, which only the pagination knows. Before
  measuring, it sets a CSS variable on each fixed image (`imagePlacement.ts`): `--image-page-top`
  (the page's top, for absolute images) or `--image-page-shift` (page top minus where the anchor
  starts, added to a float's or breaking image's top margin). The node view keeps those variables
  when it redraws the frame.

The version preview uses the same styles: `renderHTML` writes a frame for images with a layout of
their own (also used for copy and paste within the editor, which keeps the attributes as `data-`
attributes). Without the editor's width, the preview always floats wrapped images left.

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
  them, or a paragraph of their own: `wrapSquare` both sides, `wrapTopAndBottom`, or `wrapNone` with
  `behindDoc` for behind text; `distT/B/L/R` from the margin; positions relative to the column and
  paragraph, or to the page; rotation in `a:xfrm`; crop as `a:srcRect`. In line images keep rotation
  and crop. Transparency, brightness, contrast and re-colour are left out.
- Word import reads the same: anchored drawings become placed images before their paragraph,
  positions from the margins become positions from the column or the page, and inline drawings keep
  their rotation and crop.
- Markdown and plain text ignore all of it.

## Known limits

- Wrap text never puts text on both sides of an image.
- An image is anchored to a top-level block: dropped into a list or a table, it anchors to the
  whole list or table.
- Behind-text images can be pressed only where there is no text over them (or selected with the
  arrow keys).
- Word's colour adjustments (`a:lum`, `a:grayscl`, `a:alphaModFix`) are not exported or imported.
