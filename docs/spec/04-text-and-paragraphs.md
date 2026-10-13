# Text and paragraphs (P1)

## Paragraph styles

Default document font: Arial. All styles use black text unless noted, regular
weight, line spacing 1.15.

| Style | Size | Colour | Other | Space before / after (pt) |
| --- | --- | --- | --- | --- |
| Normal text | 11pt | black | | 0 / 0 |
| Title | 26pt | black | | 0 / 3 |
| Subtitle | 15pt | `#666666` | | 0 / 16 |
| Heading 1 | 20pt | black | | 20 / 6 |
| Heading 2 | 16pt | black | | 18 / 6 |
| Heading 3 | 14pt | `#434343` | | 16 / 4 |
| Heading 4 | 12pt | `#666666` | | 14 / 4 |
| Heading 5 | 11pt | `#666666` | | 12 / 4 |
| Heading 6 | 11pt | `#666666` | italic | 12 / 4 |

Space before is not applied at the very top of a page. (The spacing values are
the reference's standard defaults; verify visually against 11pt body text:
Heading 1 sits clearly apart from the preceding paragraph and close to the
following one.)

Shortcuts: Normal text ⌘+Option+0, Heading 1–6 ⌘+Option+1 … 6. Title and
Subtitle have no shortcut. Paragraph style is stored on the paragraph so it
survives export; Title and Subtitle export to Word's Title and Subtitle
styles.

Style changes keep explicit character formatting (for example a bold word stays
bold).

## Character formatting

Bold, italic, underline, strikethrough (⌘+Shift+X), superscript (⌘.), subscript
(⌘,), text colour, highlight colour, font family, font size, and
capitalisation (lowercase, UPPERCASE, Title Case — these change the characters
themselves). Links are blue (`#1155cc`) and underlined.

## Font size

Sizes are in points. The size box shows the size at the cursor: the explicit
size if set, otherwise the paragraph style's size. − and + step to the previous
or next standard size (8, 9, 10, 11, 12, 14, 18, 24, 30, 36, 48, 60, 72, 96);
outside the list they step by 1. Allowed range 1–400.

## Line and paragraph spacing

- Line spacing presets: Single (1.0), 1.15, 1.5, Double (2.0). Custom values
  are allowed through the dialog.
- "Add space before paragraph" adds 10pt before; when the paragraph already
  has space before, the item reads "Remove space before paragraph" and sets it
  to 0. Same for "after".
- **Custom spacing dialog** (title "Custom spacing"): "Line spacing" number
  field; "Paragraph spacing (pts)" with "Before" and "After" number fields;
  buttons Cancel and Apply. Values apply to every paragraph in the selection.

## Indentation

- Increase indent (⌘+], or Tab outside lists and tables) moves the paragraph's
  left indent by 1.27 cm (0.5 in, 48px). Decrease indent (⌘+[, Shift+Tab)
  moves it back, not below 0.
- In a list, Tab and Shift+Tab change the list level instead.
- In a table, Tab and Shift+Tab move between cells.

## Lists

- First-level list items: the glyph sits about 28px and the text 48px right
  of the paragraph's left edge. Each nested level adds 48px.
- Preset grids show each preset as a small bordered tile (about 60 × 75px,
  1px `#c4c7c5` border, radius 2px) previewing five lines: level 1, level 2,
  level 2, level 3, level 1, each glyph or number followed by a grey bar. The
  current preset tile has a primary-colour border.
- Bulleted list presets (3 columns × 2 rows, in this order):
  1. ● ○ ■ (default)
  2. ❖ ➢ ■
  3. ❏ ❏ ❏ (a square with a drop shadow at every level)
  4. ➔ ◆ ●
  5. ★ ○ ■
  6. ➢ ○ ■
  The glyph for a level repeats cyclically for deeper levels.
- Numbered list presets (3 columns × 2 rows, in this order):
  1. 1. a. i. (default)
  2. 1) a) i)
  3. 1. 1.1. 1.1.1. (outline numbering; the preview's third line reads
     "1.2.", its fourth "1.2.1.")
  4. A. a. i.
  5. I. A. 1.
  6. 01. a. i. (two-digit, zero-padded first level)
- Checklist (⌘+Shift+9): each item has a checkbox. Two presets: plain, and
  "strike through checked items" (checked items are struck through and grey).
  Clicking a checkbox toggles it; the state is saved with the document.
- Pressing Enter on an empty list item ends the list.

## Page breaks

Insert > Break > Page break (⌘+Enter) inserts a page break node. In print
layout the content after it starts on a new page; in exports it becomes a page
break.

## Acceptance

- Applying each style gives the size, colour and italics in the table.
- Space before/after values from the table are visible between paragraphs and
  editable through Custom spacing.
- Superscript, subscript, strikethrough (⌘+Shift+X) and capitalisation work
  and survive reload.
- Choosing the ★ bullet preset changes the glyphs of the current list.
- Checklist items can be checked and stay checked after reload.
- ⌘+] and ⌘+[ change indentation.
