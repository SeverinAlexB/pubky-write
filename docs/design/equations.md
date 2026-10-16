# Design: equations

Our own design for the equation part of spec 20.

## Storage

An equation is an inline leaf node `equation` (`shared/src/equation.ts`) whose only attribute,
`latex`, is the equation's LaTeX source (at most 10,000 characters). It is ordinary inline content:
it takes marks (font size, suggestion marks), is one position wide, and every change of it is a
`ReplaceStep` of that one position. So the sync, the server's step authority, undo per tab,
comment anchors, offline edits and version history need nothing new.

The editor does not keep LaTeX strings while it edits: `shared/src/equations/` has a model of an
equation (`model.ts`), and reads and writes LaTeX from and to it (`latex.ts`).

| Atom | LaTeX |
| --- | --- |
| `char`: one letter, digit, operator or symbol | `x`, `2`, `+`, `\alpha`, `\leq`, `\sum` (a symbol by its usual command) |
| `name`: an upright operator name | `\sin`, `\lim`, `\operatorname{…}` |
| `text` | `\text{…}`, `\mathrm{…}` |
| `frac` (numerator, denominator) | `\frac{a}{b}` |
| `sqrt` (body, index or none) | `\sqrt{x}`, `\sqrt[n]{x}` (`\nroot{n}{x}` is read too) |
| `scripts` (subscript, superscript, either may be missing) | `_a`, `^{n+1}`; they belong to the atom before them, an empty base is `{}` |
| `fence` (opening and closing bracket, body) | `\left( … \right)`, `\left. … \right|` |
| `accent` (hat, bar, overline, underline, tilde, vec, dots, braces, boxed, phantom) | `\hat{x}`, `\overline{x}`, `\overbrace{x}`, `\boxed{x}` |
| `matrix` (environment, rows of cells) | `\begin{pmatrix}a & b \\ c & d\end{pmatrix}`, `cases`, `gathered`… |
| `raw`: LaTeX the model does not cover | as written (`\mathbb{R}`, `\begin{array}{cc}…`) |
| `command`: a backslash command being typed | never stored |

Writing is canonical (single characters unbraced, `\alpha x` with a space), and reading what was
written gives the same model: `tests/property/equations.property.test.ts` checks that for random
equations of every kind of atom, and that Office Math and Markdown give back the same LaTeX.
LaTeX from elsewhere (a Markdown file) that the model does not cover is kept in `raw` atoms, so
reading and writing an equation never changes it.

## Drawing: native MathML

Equations are drawn as MathML (`mathml.ts`), which Chrome, Firefox and Safari lay out themselves
(MathML Core): italic identifiers, upright numbers and operators, fractions, roots, scripts, big
operators with their limits under and over them (beside them for integrals), stretching brackets
and accents, at the surrounding font size, in the system's maths font (`STIX Two Math`, `Cambria
Math`, `Latin Modern Math` or the browser's `math` font; none is bundled). Fractions are drawn at
full size (display style) also in the text line.

We considered:

- **KaTeX** (MIT): HTML and CSS output, which needs its CSS and about 60 font files, and whose
  output has no stable correspondence with the source for a caret.
- **MathLive** (MIT): an editor of its own (about 800 KB, with fonts and sounds) whose behaviour
  differs from the spec in many places (its LaTeX mode, unknown commands shown as errors, inline
  shortcuts), inside a shadow root with its own focus and undo.
- **temml** (MIT): LaTeX to MathML, complete, but again no mapping from the source to the elements
  for the caret and the slots.

Drawing from our own model needs no library for anything the editor makes, and the model is what
the caret moves through: every row carries `data-path` and every atom `data-atom`, so the caret is
placed from the boxes of the atoms around it. **temml 0.14** is still used, loaded only when an
equation holds `raw` LaTeX: its MathML for that part is put in place of the raw text.

## Loading

| Chunk | Size (min / gzip) | Loaded |
| --- | --- | --- |
| The `equation` node, the editing plugin and the node view (`equations.ts`, `load.ts`) | about 3 KB in the editor's bundle | with the editor |
| The model, LaTeX, MathML and editing (`equationCode.ts` and `@docs/shared/equations`) | 28.5 KB / 9.8 KB | before a document with an equation is shown (`EditorPage`, which checks the content and the headers, footers and footnotes); otherwise when the editor is idle (like the dialogs), or with the first equation inserted, pasted or opened in version history if that is sooner |
| The equation toolbar | 4.7 KB / 1.8 KB | while it is shown |
| temml | 204 KB / 60 KB | only for LaTeX the model does not cover |

Equations and emoji (spec 20) together added 12.7 KB (3.0 KB gzip, 0.8%) to the JavaScript loaded
to open a document, now 1,202 KB (378 KB gzip).

Until the code has loaded an equation shows its LaTeX; once it is there the node views draw maths
and the pages are laid out again. Static copies (headers on other pages) use the renderer the code
registers with `registerEquationRenderer`.

## Editing

While the cursor is in an equation, the equation is selected as a node (`NodeSelection`) and the
plugin in `equations.ts` holds `{ pos, row, caret, latex }`: the model with any command being
typed, the caret as a path of slots and an offset, and the LaTeX that is stored. The editor keeps
the focus; the plugin's `handleKeyDown` (before every key binding) turns keys into model edits
(`editing.ts`, pure functions, unit tested):

- letters, digits and operators insert themselves; `^` and `_` go into the superscript or
  subscript of the atom before the caret (made if needed); `(`, `[` and `{` (and `\{`) make
  brackets with the caret inside, and typing the closing bracket at their end steps out;
- `\` starts a command shown as grey text; a space or any non-letter ends it, and it becomes
  its symbol or structure (`\frac`, `\sqrt`, `\nroot`, `\sum` and the other big operators with
  both limits, `\lim` with its lower limit, accents) with the caret in the first slot, an
  operator name, or (unknown) its text;
- ← and → move through the structure (into a structure's first or last slot, from slot to slot, out
  after it), Tab and Shift+Tab leave the current slot, ↑ and ↓ move between numerator and
  denominator (and superscript and subscript, matrix rows); ← at the start and → at the end leave
  the equation, ↑ and ↓ elsewhere leave it and move to the next line;
- Backspace deletes the atom before the caret, goes into a structure before it, removes a structure
  whose slot is empty (keeping what its other slots hold) and at the start of the equation leaves
  it;
- Enter and Escape leave the equation after it.

Each edit that changes the stored LaTeX is one `setNodeMarkup` (grouped into undo steps like
typing); moving the caret changes only the plugin state. The node view draws the equation from the
plugin's model, passed in a node decoration, with the caret (a blinking 1px line over the MathML)
and a dotted box for each empty slot; the equation's background is `#f1f3f4`.

The cursor comes into an equation when it is inserted (at its start), from the left (start) or the
right (end) with the arrow keys, or by a click (the caret position nearest to the click, measured
on the drawing for editing). When it leaves, commands still being typed are finished and an empty
equation is deleted, in an appended transaction. Text typed through an input method is typed
character by character; text pasted into an equation (or a copied equation) is read as LaTeX and
inserted at the caret.

The equation toolbar (`EquationToolbar.tsx`, View > Show equation toolbar, kept in
`docs.equationToolbar`; turned on by Insert > Symbols > Equation) inserts a new equation and,
while the cursor is in one, the symbols and structures of its five menus at the caret (structures
with the caret in their first slot). It acts on the header, footer or footnote being edited, like
the main toolbar.

## Suggestions

An inserted equation is inline content and gets the `suggestionInsert` mark like text; its card
says "Add: Equation" (equations are named like objects). The suggestion rewrite compares documents
with `equationTokens`, an encoder for prosemirror-changeset in which an equation equals only an
equation with the same LaTeX, so changing an existing equation in Suggesting mode is a "Replace:
Equation with Equation": the old one struck through, the new one inserted after it and edited in
place from then on (the plugin follows it to its new position). Version history uses the same
encoder, so a changed equation is an edit there.

## Clipboard, exports and imports

- **Clipboard:** the HTML is `<span class="equation" data-latex="…">` with the MathML in it, read
  back by its `data-latex`; MathML from other applications is read when it carries an
  `application/x-tex` annotation. The plain text is the LaTeX.
- **Word** (`server/src/omml.ts`): Office Math (`m:oMath`) in the paragraph, written as an
  `ImportedXmlComponent` tree. Characters are runs (`m:r`, in Cambria Math), operator names and
  `\mathrm` upright runs (`m:sty="p"`), `\text` normal text (`m:nor`); fractions `m:f`, roots
  `m:rad` (`m:degHide` without an index), scripts `m:sSub`, `m:sSup`, `m:sSubSup`; a big operator
  followed by scripts an `m:nary` with its character and limit location (its operand stays empty:
  the model has none); `\lim` with limits `m:limLow` / `m:limUpp`; brackets `m:d`; accents `m:acc`,
  `\overline` and `\underline` `m:bar`, braces `m:groupChr`, `\boxed` `m:borderBox`, `\phantom`
  `m:phant`; matrices `m:m` (in an `m:d` for `pmatrix` and the others), `gathered` and `aligned`
  `m:eqArr`. LaTeX the model does not cover is written as normal text in the equation (the spec's
  fallback to a picture is not built: Word shows the LaTeX). Inserted and deleted equations are in
  `w:ins` / `w:del`. The import reads all of these (and `m:sPre`, `m:func`, `m:box`, several
  `m:e` in a bracket with its separator) into the model; an equation in `w:ins` or `w:del` becomes
  a suggestion. The corpus test checks that every word of the files' equations is kept.
- **Markdown:** `$LaTeX$`; a dollar sign in text is written `\$`. The import reads `$…$` and
  `$$…$$` with Pandoc's rule (the opening `$` before a non-space, the closing one after a non-space
  and not before a digit, so "costs $5 or $10" stays text).
- **Plain text** and the server's search text: the LaTeX.
- **Print and PDF:** the MathML as drawn, without the caret, the grey background and the toolbar.

## Known limits

- There is no selection inside an equation: Shift with the arrow keys selects from the equation in
  the text, and copying copies whole equations.
- Find does not search inside equations and word count does not count them; a comment on an
  equation alone quotes its LaTeX.
- Word's n-ary operators get an empty operand (what follows them stays after them), `aligned`
  comes back as `gathered`, and `\widehat`, `\widetilde` as `\hat`, `\tilde`.
- Undo groups an equation's edits with typing around them as it groups typing.
