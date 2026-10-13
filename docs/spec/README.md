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

## Priorities

- **P1** – required in this pass.
- **P2** – required if time allows; keep the design open for it.
- **Out of scope** – features that depend on services this app does not have
  (sharing, other users, cloud drive, AI, add-ons, video calls). Do not show
  controls for them.

## Acceptance

Each document ends with acceptance criteria. A feature is done when its
criteria pass in an end-to-end test and the existing tests still pass.
