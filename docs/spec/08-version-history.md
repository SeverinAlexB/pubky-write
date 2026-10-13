# Version history (P1)

Opening version history (File > Version history > See version history,
⌘+Option+Shift+H, or the header clock button) switches the whole window into a
read-only history mode.

## Layout

- **Top bar** (replaces header and toolbar), surface colour, 56px:
  - Left: a "Back" arrow button that returns to editing, then the selected
    version's name or time in 18px, for example "Today, 15:42" or
    "13 October, 15:36".
  - Below it, a slim rounded toolbar with Print and a zoom dropdown on the
    left, and on the right "Total: N edits" and two round buttons "Previous
    edit" (chevron up) and "Next edit" (chevron down) that scroll to the
    previous/next highlighted change.
- **Document preview** in the centre: the selected version rendered as pages,
  read-only.
- **Right panel**, 300px, white:
  - Header "Version history" with a ⋮ menu (P2).
  - A dropdown "All versions" / "Named versions" (P2: named versions).
  - Versions grouped under day headings ("Today", "Yesterday", or a date).
    Each entry: the date and time ("13 October, 15:42"), the label
    "Current version" for the newest, and the author with a coloured dot. An
    entry that represents several sessions has an expand arrow (P2).
  - Each entry has a ⋮ menu: Restore this version (not on the current
    version), Name this version (P2), Make a copy.
  - The selected entry has a light primary-container background.
  - At the bottom: a checkbox "Highlight changes" (on by default).

## Highlight changes

With "Highlight changes" on, the preview marks text that was added in the
selected version compared with the version before it: added text is shown in
teal (measured `#52a49a`) on a light teal background (measured `#ddedeb`);
removed text is shown struck through in red (`#c5221f`, P2). "Total: N edits" counts the changed
ranges.

## Restoring

Choosing Restore this version asks "Restore this version?" with Cancel and
Restore. Restoring returns to editing mode with the restored content; the
restore appears as a new version.

## Acceptance

- The mode replaces header and toolbar with the top bar and shows the right
  panel with day groups and "Current version".
- Selecting an older version shows it in the preview with additions
  highlighted and the "Total: N edits" count.
- Previous/Next edit scroll between highlighted changes.
- Restore via the entry's ⋮ menu works and returns to editing.
- Back returns to editing without changes.
