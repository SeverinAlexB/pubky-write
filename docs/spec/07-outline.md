# Tabs and outline sidebar (P1)

This app has one tab per document ("Tab 1"). Multiple tabs are out of scope.

## Collapsed state

When the sidebar is closed, a 40px round button with a list icon sits at the
top left of the editor area (about 16px from the left ruler, 18px below the
ruler), tooltip "Show tabs and outlines". The page column is centred in the
full width.

## Open state

- A sidebar 280px wide at the left of the editor area (after the vertical
  ruler), same surface colour as the background, no border. The page column
  re-centres in the remaining space.
- Top: a back-arrow button ("Hide tabs and outlines").
- Section header "Document tabs" (14px, medium weight).
- The single tab as a pill row (height 40px, radius 20px, primary container
  background `#d3e3fd` when it is the current tab): a document icon, the name
  "Tab 1" in primary text colour, a small round badge with the number of open
  comments (only if > 0), and a ⋮ button (P2: Rename).
- Under the tab, the outline: every heading (Title, Heading 1–6) in document
  order. A 1px vertical guide line runs along the left of the list.
  Indentation: 12px per heading level below the highest level used.
  Items are 14px text, 36px tall, single line with ellipsis.
- The heading containing the cursor is shown in primary colour with a 2px
  primary bar on the guide line at its row.
- Clicking a heading scrolls the document so the heading is at the top of the
  view and puts the cursor at its start.
- Empty headings are not listed. If there are no headings, show the hint
  "Headings that you add to the document will appear here." under the tab.
- Open state persists per user.

## Acceptance

- The collapsed button is visible at the top left and opens the sidebar.
- The sidebar shows "Document tabs", the "Tab 1" pill and the headings nested
  by level with a guide line.
- The current heading is highlighted as the cursor moves.
- The comment badge on the tab shows the number of open comments.
