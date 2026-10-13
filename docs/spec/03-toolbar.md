# Toolbar (P1)

One rounded container (see 09) from x=16 to the right edge minus 16px (minus
the side panel if any), 40px high. Controls are left-aligned in this order,
with 1px × 20px vertical dividers where marked "|". Every control has a tooltip
(shown on hover after a short delay) with its name and shortcut, as listed.

| # | Control | Tooltip | Size |
| --- | --- | --- | --- |
| 1 | Search the menus (magnifier) | "Search the menus (Option+/)" — opens a small search field that filters all menu items by name and runs the chosen one. P2; show the button. | 30 |
| 2 | Undo | "Undo (⌘Z)" | 30 |
| 3 | Redo | "Redo (⌘Y)" | 30 |
| 4 | Print | "Print (⌘P)" | 30 |
| 5 | Spelling and grammar check | *(omit)* | |
| 6 | Paint format | "Paint format" — copies the formatting of the selection; the next selection receives it. Double-click keeps it active until Escape. P2 | 30 |
| 7 | Zoom | combobox showing "100%" with a ▾; menu: Fit, —, 50%, 75%, 90%, 100%, 125%, 150%, 200%. Typing a number sets a custom zoom. | 75 |
| | \| | | |
| 8 | Styles | dropdown showing the current paragraph style name ("Normal text") with ▾, width 122px | 122 |
| | \| | | |
| 9 | Font | dropdown showing the font name with ▾, width 97px | 97 |
| | \| | | |
| 10 | Decrease font size | "Decrease font size (⌘+Shift+comma)", a − icon | 24 |
| 11 | Font size | a small outlined box (34 × 24px, radius 4px) with the size in points; clicking opens the size list (8, 9, 10, 11, 12, 14, 18, 24, 30, 36, 48, 60, 72, 96); typing a number and Enter applies it | 34 |
| 12 | Increase font size | "Increase font size (⌘+Shift+full stop)", a + icon | 24 |
| | \| | | |
| 13 | Bold | "Bold (⌘B)" | 30 |
| 14 | Italic | "Italic (⌘I)" | 30 |
| 15 | Underline | "Underline (⌘U)" | 30 |
| 16 | Text colour | "Text colour" — an "A" with a 4px colour bar under it showing the current colour; opens the colour palette | 32 |
| 17 | Highlight colour | "Highlight colour" — a marker icon; palette with a "None" entry first | 32 |
| | \| | | |
| 18 | Insert link | "Insert link (⌘K)" | 30 |
| 19 | Add comment | "Add comment (⌘+Option+M)" — disabled without a selection | 30 |
| 20 | Insert image | "Insert image" — menu: Upload from computer, By URL | 32 |
| | \| | | |
| 21 | Align and indent | an align icon showing the current alignment with ▾; opens a horizontal row of four icon buttons (Left, Centre, Right, Justified) with the current one selected | 39 |
| 22 | Line & paragraph spacing | icon; opens the same menu as Format > Line & paragraph spacing | 32 |
| 23 | Checklist | "Checklist (⌘+Shift+9)" toggles a checklist; a narrow ▾ beside it ("Checklist menu") opens two presets: checkbox only, and checkbox with strike-through of checked items | 30 + 12 |
| 24 | Bulleted list | "Bulleted list (⌘+Shift+8)"; ▾ "Bulleted list menu" opens a 3 × 2 grid of the six glyph presets (see 04), then a separator and a "Checklist menu ▸" item (checklist icon) whose submenu shows the two checklist presets | 30 + 12 |
| 25 | Numbered list | "Numbered list (⌘+Shift+7)"; ▾ "Numbered list menu" opens a 3 × 2 grid of the six numbering presets (see 04) | 30 + 12 |
| 26 | Decrease indent | "Decrease indent (⌘+[)" | 30 |
| 27 | Increase indent | "Increase indent (⌘+])" | 30 |
| 28 | Clear formatting | "Clear formatting (⌘+\)" | 30 |

At the right end of the toolbar: a "Hide the menus (⌘+Shift+F)" chevron (P2).

## Overflow

When the window is too narrow, controls from the right end move into a "More"
button (⋮) at the end of the toolbar, which opens them in a second floating
toolbar row below. At 1440px, items 26–28 are in "More".

## Active states

- Bold, Italic, Underline, list buttons and checklist show the pressed state
  (primary container background) when active at the cursor.
- Styles, Font, Font size and Zoom always show the value at the cursor; a
  mixed selection shows an empty value.

## Dropdown details

### Styles

A menu 220px wide. Each entry shows the style's name rendered in that style
(scaled so large styles fit: Title about 28px, Heading 1 about 26px, Heading 2
about 22px, Subtitle about 18px in grey), with a check mark in front of the
current style and a ▸ opening "Apply '<style>'" (P2: "Update '<style>' to
match"). Order: Normal text, Title, Subtitle, Heading 1, Heading 2, Heading 3,
then "Options ▸" (P2). Entries are separated by dividers. Heading 4–6 are only
in Format > Paragraph styles.

### Font

A menu 240px wide: "More fonts" (P2) with an icon, a divider, a "RECENT"
section header (small caps, secondary text) with the most recently used fonts,
a divider, then all available fonts alphabetically. Every font name is
rendered in its own typeface; the current font has a check mark. The list
scrolls. Fonts: Arial (default), Arial Black, Comic Sans MS, Courier New,
Georgia, Impact, Roboto, Roboto Mono, Times New Roman, Trebuchet MS, Verdana.

### Colour palette

A popover with: (highlight only) "None" as a text button; a 10 × 8 grid of
18px round swatches with 4px gaps; a "CUSTOM" label; a "+" button that opens a
native colour picker and adds the colour to a custom row. The current colour
has a check mark inside its swatch. Swatches (rows top to bottom):

```
#000000 #434343 #666666 #999999 #b7b7b7 #cccccc #d9d9d9 #efefef #f3f3f3 #ffffff
#980000 #ff0000 #ff9900 #ffff00 #00ff00 #00ffff #4a86e8 #0000ff #9900ff #ff00ff
#e6b8af #f4cccc #fce5cd #fff2cc #d9ead3 #d0e0e3 #c9daf8 #cfe2f3 #d9d2e9 #ead1dc
#dd7e6b #ea9999 #f9cb9c #ffe599 #b6d7a8 #a2c4c9 #a4c2f4 #9fc5e8 #b4a7d6 #d5a6bd
#cc4125 #e06666 #f6b26b #ffd966 #93c47d #76a5af #6d9eeb #6fa8dc #8e7cc3 #c27ba0
#a61c00 #cc0000 #e69138 #f1c232 #6aa84f #45818e #3c78d8 #3d85c6 #674ea7 #a64d79
#85200c #990000 #b45f06 #bf9000 #38761d #134f5c #1155cc #0b5394 #351c75 #741b47
#5b0f00 #660000 #783f04 #7f6000 #274e13 #0c343d #1c4587 #073763 #20124d #4c1130
```

Light swatches (rows 1 columns 7–10) have a 1px `#c4c7c5` border so they are
visible on white.

### Line & paragraph spacing

Same as Format > Line & paragraph spacing (02), with the current line spacing
checked.

## Acceptance

- Controls appear in the order above with the listed tooltips (as accessible
  names).
- Strikethrough is not a toolbar button.
- The colour palette has exactly the 80 swatches above.
- Font size + and − step through the standard sizes; typing 13 applies 13pt.
- At a narrow window width, overflowed controls are reachable through "More".
