# Functional specification (clean room)

This folder is the only description of the reference product that implementers
may use. It was written by the research side from observing the reference
editor's user interface on 2026-10-13 (window 1440 × 900, en-GB locale).

## Rules for implementers

- Build only from this specification and this repository.
- Do not open the reference product, its network traffic, its code or the
  research captures. If something is unclear, ask for the spec to be extended
  instead of looking it up.
- Do not use the reference product's name, logo, product icons or proprietary
  fonts. Use the app's own name ("Docs"), its own logo
  (`client/public/favicon.svg`), system or open-licensed fonts, and an
  open-licensed icon set.
- Visible labels, keyboard shortcuts, measurements and colours in this spec are
  functional requirements and may be used as written.

## Documents

| File | Area |
| --- | --- |
| [01-layout.md](01-layout.md) | Window layout: header, menu bar, toolbar, rulers, pages |
| [02-menus.md](02-menus.md) | Menu bar contents and behaviour |
| [03-toolbar.md](03-toolbar.md) | Toolbar controls, order and dropdowns |
| [04-text-and-paragraphs.md](04-text-and-paragraphs.md) | Paragraph styles, fonts, colours, spacing, lists |
| [05-find-and-count.md](05-find-and-count.md) | Find bar, Find and replace dialog, word count |
| [06-comments.md](06-comments.md) | Comments in the margin |
| [07-outline.md](07-outline.md) | Tabs and outline sidebar |
| [08-version-history.md](08-version-history.md) | Version history mode |
| [09-visual-language.md](09-visual-language.md) | Colours, shapes, typography of the UI |
| [10-home.md](10-home.md) | Document list, templates band, import |
| [11-tables-and-images.md](11-tables-and-images.md) | Table insertion, appearance, menus; image selection and resizing |
| [12-context-menu.md](12-context-menu.md) | Right-click menu |
| [13-page-elements.md](13-page-elements.md) | Headers, footers, page numbers, footnotes, table of contents |
| [14-special-characters-and-ruler.md](14-special-characters-and-ruler.md) | Special characters dialog, ruler dragging, Page setup dialog details |

## Priorities

- **P1** – required in this pass.
- **P2** – required if time allows; keep the design open for it.
- **Out of scope** – features that depend on services this app does not have
  (sharing, other users, cloud drive, AI, add-ons, video calls). Do not show
  controls for them.

## Acceptance

Each document ends with acceptance criteria. A feature is done when its
criteria pass in an end-to-end test and the existing tests still pass.

## Revisions

### Round 1 (after comparing the first implementation with the reference)

- 02: Format > Paragraph styles shows plain text items, not previews.
- 03/04: Six bullet presets and six numbering presets in 3 × 2 grids; the
  bulleted list menu ends with a "Checklist menu ▸" item; preset tile layout.
- 05: Find and replace has no scrim, focuses the Find field, and ⌘+Shift+H must
  not change formatting (it currently toggles a highlight on the selection).
  Word count rows are 52px with 14px text and a 24px title.
- 07: The tab's comment badge is a white circle with dark text.
- 08: The version history panel runs the full window height on `#f1f4f8`, has
  a full-width outlined "All versions" box, and shows the selected version as
  a white card.

### Round 2 (second capture session)

New documents 10–14. 14 also amends the Page setup dialog described in 02.

### Round 2 corrections (after comparing the round 2 implementation)

- 13: Header/footer editing does not dim the body; the label band spans the
  page width (24px, lines top and bottom); opening a footer scrolls it into
  view. Top-level table of contents entries are bold and the block has no
  border. In the Page numbers dialog "Start at" comes before "Continue from
  previous section".
