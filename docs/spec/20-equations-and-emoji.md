# Equations and emoji (P1)

## Equations

### Inserting

Insert > Symbols > Equation inserts an empty inline equation at the cursor,
puts the cursor in it, and shows the **equation toolbar**. Insert > Symbols >
Equation is also reachable as "Equation" in the right-click menu's Insert
items (P2).

### Equation toolbar

- A full-width bar directly under the main toolbar, 41px tall, white, with a
  1px `#e1e3e1` bottom border, shown while View > Show equation toolbar is on
  (on after inserting the first equation; the setting persists).
- Left to right: a "New equation" text button (14px, secondary colour when no
  equation is active), then five dropdown buttons (44 × 30px, each showing
  three sample symbols and a ▾), and at the far right a "Hide equation
  toolbar" × button.
  - Greek letters (αβΔ): α β γ δ ϵ ε ζ η θ ϑ ι κ λ μ ν ξ π ϖ ρ ϱ σ ς τ υ ϕ φ χ
    ψ ω Γ Δ Θ Λ Ξ Π Σ Υ Φ Ψ Ω — a 6-column grid.
  - Miscellaneous operations (×÷∃): × ÷ · ± ∓ ∗ ⋆ ∘ • ⊕ ⊖ ⊘ ⊗ ⊙ † ‡ ∨ ∧ ∩ ∪
    ℵ ℜ ℑ ⊤ ⊥ ∞ ∂ ∀ ∃ ¬ △ ⋄ — 6 columns.
  - Relations (<≠⊃): ≤ ≥ ≺ ≻ ⪯ ⪰ ≪ ≫ ≡ ∼ ≃ ≍ ≈ ≠ ⊂ ⊃ ⊆ ⊇ ∈ ∋ ∉ — 6 columns.
  - Maths operations (√()x): structures shown as rendered previews in a
    6-column grid: fraction a/b, square root √x, n-th root, sub+superscript
    x_a^b, subscript x_a, superscript x^b; overline x̄, hat x̂, big
    intersection, big union, product, coproduct (each with limits a, b);
    parentheses ( ), brackets [ ], braces { }, absolute value | |, integral
    ∫_a^b, contour integral ∮_a^b; sum Σ_a^b, limit lim_{a→b}.
  - Arrows (←↑⇒): ← → ↔ ⇐ ⇒ ⇔ ↑ ↓ ↕ ⇑ ⇓ ⇕ — 6 columns.
- The dropdowns are enabled only while the cursor is inside an equation;
  "New equation" inserts another equation at the cursor. Choosing a symbol
  inserts it; choosing a structure inserts it with empty slots and the cursor
  in the first slot.

### Editing an equation

- An equation is an inline object in the text line, rendered as maths
  (italic variables, upright numbers and operators, proper fractions,
  roots, scripts and big operators) at the surrounding font size.
- While the cursor is inside, the equation has a light grey background
  `#f1f3f4` and each empty slot shows a small dotted box.
- Typing: letters, digits and operators insert themselves. `^` starts a
  superscript and `_` a subscript at the cursor; → (or Tab) leaves the current
  slot; ← / → move through the structure; ↓ / ↑ move between the numerator and
  denominator of a fraction.
- Backslash commands followed by a space (or any non-letter) become the
  symbol or structure: every symbol in the menus above by its usual name
  (`\alpha`, `\Gamma`, `\times`, `\leq`, `\rightarrow`, `\infty`, …), and the
  structures `\frac`, `\sqrt`, `\nroot` (n-th root), `\sum`, `\prod`,
  `\coprod`, `\bigcap`, `\bigcup`, `\int`, `\oint`, `\lim`, `\bar`, `\hat`,
  `\overline`, plus brackets `(`, `[`, `\{` which auto-close. An unknown
  command stays as the typed text.
- Backspace at the start of an empty slot removes the structure; Backspace at
  the start of the equation leaves it; deleting all content leaves an empty
  equation that disappears when the cursor leaves it.
- Equations are stored in the document (as LaTeX source); copy/paste between
  documents keeps them; they survive reload, undo/redo, version history and
  suggestions (inserting an equation in Suggesting mode is "Add: Equation").
- Export: Word as native equations (OMML) where possible, otherwise an image;
  Markdown as `$…$`; plain text as the LaTeX source. Import: Word OMML
  equations become equations; Markdown `$…$` becomes equations.

## Emoji

### Emoji picker

- One picker component used in three places: Insert > Symbols > Emoji (and
  ⌘+Ctrl+Space where the system does not take it), comment reactions, and tab
  emoji (18).
- 370 × 404px popover, white, radius 8px, card shadow, opening below its
  trigger (flipped above if there is no room).
- Contents top to bottom: a search pill (310 × 32px, "Search", magnifier icon);
  a row of 9 category icons, 36px each with "Scroll to previous" / "Scroll to
  next" arrows at the ends when they do not fit: Smileys and emotions,
  People, Animals and nature, Food and drink, Travel and places, Activities
  and events, Objects, Symbols, Flags (the current category's icon in primary
  colour with an underline); then a scrolling grid "Browse emoji list" of 40
  × 40px cells (30px emoji), 9 per row, with sticky uppercase section headers
  ("SMILEYS AND EMOTIONS", 11px, secondary). A "Recently used" section (P2)
  appears first once emoji have been used.
- Clicking a category scrolls to its section; scrolling updates the selected
  category. Search filters by name and keywords across all categories (e.g.
  "thumb" → 👍 👎); no results shows "No emoji found".
- Hovering a cell shows its name as a tooltip; skin-tone variants (P2) via
  long press.
- Keyboard: arrow keys move in the grid, Enter chooses, Escape closes and
  returns focus.
- Data: Unicode emoji with names and keywords (a bundled, lazily loaded data
  file).

### Inserting emoji

- Insert > Symbols > Emoji opens the picker at the cursor; choosing inserts the
  emoji at the cursor and closes the picker.
- Colon picker (Tools > Preferences > "Insert emoji using the colon
  character", on by default): typing `:` followed by at least two letters
  (after a space or at the start of a paragraph) shows a small list under the
  cursor (up to 8 matching emoji with their names, the first highlighted);
  ↑/↓ choose, Enter or Tab inserts, Escape or typing a space dismisses.

### Comment reactions

- Each comment message in an active card shows an "Add emoji reaction" button
  (32px round, smiley icon) at the right of the message on hover; it opens
  the picker anchored below it.
- Choosing an emoji adds a **reaction chip** under that message: a pill
  (24px tall, radius 12px, 1px `#c4c7c5` border, white) showing the emoji
  and the count ("😀 1"); the current user's own reactions have a primary
  container background and a primary border. Several different reactions sit
  in a row with 4px gaps, followed by a small "Add emoji reaction" chip
  (smiley +).
- Clicking one's own reaction chip removes it; hovering a chip shows "You
  reacted with :name:".
- Reactions are stored on the server per message and are shown in idle cards
  too (chips only, no add button) and in All comments.

## Acceptance

- Insert > Symbols > Equation shows the equation toolbar; typing
  `x^2` → `x²` rendered; `\alpha ` → α; `\frac ` then `a`, ↓, `b` gives a
  fraction a/b; choosing √x from Maths operations inserts a root with the
  cursor inside.
- An equation persists after reload and exports to Word as an equation and
  to Markdown as `$…$`.
- Insert > Symbols > Emoji shows the picker with 9 categories; searching
  "thumb" shows 👍; choosing inserts it.
- Typing `:smi` shows a list starting with smiling faces; Enter inserts the
  first.
- Adding 😀 to a comment shows a "😀 1" chip that persists after reload;
  clicking it again removes it.
