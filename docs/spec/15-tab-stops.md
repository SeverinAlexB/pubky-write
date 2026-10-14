# Tab stops (P1)

Tab stops are per paragraph, like indents, and are shown on the horizontal
ruler for the paragraph at the cursor (for a multi-paragraph selection: the
first paragraph's stops; changes apply to all selected paragraphs).

## Adding

Clicking an empty spot of the ruler's writable area (not on a marker) opens a
small menu just below the click point (menu styling as in 09, a small notch
pointing to the click is optional) with:

- Add left tab-stop
- Add centre tab-stop
- Add right tab-stop
- ✓ Show ruler (toggle; same as View > Show ruler)

Choosing an item adds a stop of that kind at the clicked position, snapped as
for indent dragging (0.25 cm / ⅛ in, Alt disables). Clicking the ruler's margin
areas does not open this menu.

## Markers

Stops are drawn in the primary colour on the ruler, vertically centred in the
lower part like the indent markers:

- Left stop: a small right-pointing triangle ▶, 5 × 10px.
- Right stop: a small left-pointing triangle ◀, 5 × 10px.
- Centre stop: a small diamond ◆, 11 × 10px.

Indent markers and tab stops have an invisible hit area of at least 16 × 16px
around the visible shape, so they are easy to grab; the visible sizes stay as
specified in 01 and here.

## Moving and removing

- Dragging a stop moves it, with the dotted guide line down the page and the
  dark tooltip showing the position as a plain number with two decimals in
  the ruler unit (e.g. "13.00"). The tooltip sits above the ruler, centred on
  the stop.
- Dragging a stop down (or up) off the ruler by more than about 20px removes
  it; the marker disappears while it is off the ruler and comes back if the
  pointer returns before release.
- Each add, move or remove is one undo step and applies to all selected
  paragraphs.

## Effect on text

- Pressing Tab in a paragraph (outside lists and tables, at a position that is
  not the start of the paragraph) inserts a tab character instead of
  indenting. At the start of a paragraph, Tab keeps indenting (02/04).
- A tab character advances to the next stop to the right of the current text
  position: left stop — text starts at the stop; right stop — text ends at the
  stop; centre stop — text is centred on the stop. Without stops (or after the
  last one), tabs advance to the next multiple of 1.27 cm (0.5 in) from the
  paragraph's left indent.
- Default stops (every 1.27 cm) are not drawn on the ruler.
- Tab stops print, export to Word (as real tab stops) and import from Word.

## Acceptance

- Clicking at 6 cm on the ruler shows the four menu items; "Add left tab-stop"
  adds a ▶ marker at 6.00 cm, persisted after reload.
- With a left stop at 6 cm and a right stop at 14 cm, typing
  "Name⇥Role⇥Total" places "Role" starting at 6 cm and "Total" ending at
  14 cm.
- Dragging the stop shows "8.00" in the tooltip at 8 cm; dragging it off the
  ruler removes it.
- Tab at the start of a paragraph still indents; Tab after text inserts a tab.
- Indent markers can be grabbed anywhere within 8px of their shape.
