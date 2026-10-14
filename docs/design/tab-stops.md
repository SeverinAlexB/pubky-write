# Design: tab stops and tab characters

Our own design for spec 15.

## Data model

| What | Stored as |
| --- | --- |
| Tab stops | Attribute `tabStops` of paragraphs and headings: `null` (no stops, the default) or a list of `{ pos, kind }` sorted by `pos`, with no two stops at the same position. `pos` is in points from the **left margin** (the ruler's 0; Word measures tab stops from the margin too), `kind` is `left`, `center` or `right`. At most 64 stops. In HTML: `data-tab-stops="l170.08 c250 r396.85"`. |
| Tab character | Inline leaf node `tab` (atom, not selectable, can carry marks). Its plain text is `"\t"` (`leafText` and `renderText`), its HTML `<span class="tab-char">\t</span>`. |

The attribute has a default and a `validate` function, so documents saved before it load
unchanged and the server rejects steps with malformed stops. `shared/src/tabStops.ts` has the
node, the attribute and the pure `tabAdvance` calculation.

Tab characters typed or pasted as text (outside code blocks) become `tab` nodes. Documents with
literal `"\t"` text from before (older Word imports) still show them at half-inch steps
(`tab-size`), but they do not follow tab stops.

## Layout

The browser cannot align text to tab stops, so each `.tab-char` is an inline block whose width
is set after layout (`client/src/editor/tabLayout.ts`):

1. The tab's left edge `x` is measured with its width at 0, relative to the origin (the content
   edge of the closest `.page-content`, or the table cell).
2. `tabAdvance` finds the first stop to the right of `x`, or else the next multiple of 1.27 cm
   from the paragraph's left indent. Left stops start the following text at the stop; right stops
   subtract the width of the text up to the next tab (measured on the tab's line); centre stops
   half of it. The width is never negative and never reaches past the line's end.
3. The width is written in CSS pixels. The page stack's `zoom` scales it like everything else, so
   zoom changes and printing (laid out at 100%) do not need a new layout.

A tab's position depends on the tabs before it on its line, so the tabs of a paragraph are laid out
in order. The n-th tab of every paragraph that needs a layout is measured in the same round, so
there is one browser layout per round rather than per tab.

The editor plugin lays out again only the top-level blocks that changed and contain tabs (block
nodes are cached by identity), all of them when the editor's width changes or fonts load, and any
tab element ProseMirror drew again. It runs synchronously in the view update, before the
pagination plugin measures lines in the next frame. The same plugin runs in the header, footer and
footnote editors and the version preview; static copies of headers, footers and footnotes and the
pagination's measuring box call `layoutTabsIn` directly.

## Editing

- Tab in a paragraph inserts a tab, also at its start and on an empty line (in a code block a
  literal `"\t"`); across paragraphs it does nothing. It never indents: ⌘] and ⌘[ (also in headers,
  footers and footnotes) and the toolbar do. Shift+Tab does nothing. Lists and tables keep their
  own Tab and Shift+Tab (nest or lift the item, next or previous cell). In Suggesting mode the tab
  is inserted text like any other.
- The ruler shows the stops of the paragraph at the cursor (the first selected one). A click on the
  writable area opens the menu; adding, moving (remove at the old position and add at the new one)
  and removing apply to every selected paragraph and heading, one undo step each.
- Find reads a tab as `"\t"`; word count as white space (a character, not a non-space one).

## Exports and import

- Word: `w:tabs` with `left`, `center` and `right` stops, and `w:tab` runs. Import reads direct
  paragraph tab stops (`start`/`end` as left/right, `decimal` as right; `bar` and `clear` are left
  out) and `w:tab` runs as tab nodes. Tab stops inherited from Word styles are not read.
- Markdown: a tab character, or `&#9;` at the start of a line (where a tab would start a code
  block). Markdown import turns tab characters into tabs.
- Plain text: a tab character.
