# Document tabs (P1)

A document can contain several tabs. Each tab has its own body content (its
own pages, headings and outline); the document title, page setup, headers and
footers are shared by all tabs. Amends 07, which assumed a single tab.

## Sidebar

- The "Document tabs" header row (07) gets an "Add tab" (+) button at the
  right. It adds a tab named "Tab N" (next free number) after the current tab
  and switches to it. The new tab starts empty with the cursor at its start.
- Each tab is a row in the sidebar: document icon (or the tab's emoji if one
  was chosen), the tab name, the open-comment badge (07), and on hover or when
  current a ⋮ "Tab options" button. The current tab has the pill styling from
  07; other tabs have no background (hover: `#f1f4f8`).
- The "Headings that you add to the document will appear here." hint (07) is
  not shown for tabs; a tab without headings simply shows no outline.
- Clicking a tab switches to it (scroll position per tab is remembered during
  the session). The current tab's headings are listed under it (07); other
  tabs show their outline only when "Show outline" is on for them.
- Subtabs (P1): tabs can be nested under a tab, shown indented by 16px with an
  expand/collapse chevron on the parent. Nesting depth up to 3.
- Drag and drop reorders tabs and moves them in or out of a parent (P2;
  "Move up", "Move down" and "Move into ▸" in the menu are P1).

## Tab options menu (⋮)

Add subtab · Delete · Duplicate · Rename · Choose emoji — Copy link · Show
outline (toggle) — Move up · Move down · Move into ▸ (list of other top-level
tabs, and "Top level").

- Delete asks "Delete tab?" with the tab name and a note that its content will
  be removed, Cancel / Delete; deleting the last remaining tab is not
  possible (item disabled). Subtabs are deleted with their parent.
- Duplicate creates "Copy of <name>" right after it with the same content.
- Rename edits the name inline in the sidebar (Enter saves, Escape cancels).
- Choose emoji opens a small emoji picker; the emoji replaces the document
  icon; a "Remove emoji" entry appears when one is set.
- Copy link copies a URL that opens the document on that tab
  (`?tab=<id>`).

## Behaviour across the app

- The document list thumbnail shows the first tab.
- Find searches the current tab (P2: option "All tabs").
- Word count counts the current tab.
- Comments and suggestions belong to the tab where their text is; the comment
  margin shows the current tab's threads; "All comments" lists all tabs with
  the tab name on each card.
- Version history shows all tabs (the preview has the same tab sidebar).
- Exports: Word and Markdown export the current tab by default; File >
  Download offers "Current tab" / "All tabs" (all tabs: each tab starts on a
  new page with its name as a Heading 1). Print prints the current tab.
- Import creates a single tab.

## Acceptance

- "Add tab" creates "Tab 2", switches to it, and it persists after reload.
- Typing in Tab 2 does not change Tab 1; switching back shows Tab 1's content
  and outline.
- Rename, Duplicate, Delete (with confirmation), Move up/down, Add subtab and
  Choose emoji work and persist.
- `?tab=` links open the right tab.
- Comments in Tab 2 show in the margin only in Tab 2 and in "All comments"
  with the tab name.

## Amendment (round 5)

- **Undo per tab**: ⌘Z / ⌘Y undo and redo the edits of the current tab only;
  edits in other tabs stay. Document-wide actions (page setup, columns,
  headers/footers, tab add/delete/move/rename) are in a shared history that ⌘Z
  reaches when they are the most recent change in the current tab's timeline.
