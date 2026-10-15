# End-to-end tests

```bash
npm run e2e          # Chrome (the installed Chrome)
npm run e2e:all      # Chrome, Firefox and WebKit
npx playwright test --project=firefox    # one browser
```

Firefox and WebKit are Playwright's own builds: install them once with
`npx playwright install firefox webkit`. All browsers of one run share the test servers and their
data directory (see `playwright.config.ts`).

## Where the tests differ between browsers

The tests check the same behaviour in every browser. These places differ because the browser or
Playwright's driver for it does, not the app:

| Where | Why |
| --- | --- |
| `allowClipboard`, `readClipboard` (`helpers.ts`) | Only Chrome has clipboard permissions to grant. Firefox reads the clipboard with the preferences set in `playwright.config.ts`; WebKit allows reading it only by a real paste, so the test pastes into a scratch field. |
| `paste` in `everyday-editing.spec.ts` | Firefox ignores the data given to a constructed `ClipboardEvent`, so the test puts the data on the real clipboard and presses ⌘V. |
| Shift+right-click in `context-menu.spec.ts` | Firefox does not send the `contextmenu` event to the page for Shift+right-click (it always shows its own menu). |
| Shift+Tab to the menu bar in `accessibility.spec.ts` | Safari's Tab skips buttons without a `tabindex` (unless "Press Tab to highlight each item" is on), so the menu bar is the first stop. |
| `expectPoints` in `text.spec.ts` | Firefox computes font sizes in steps of 1/64 px. |
| Mouse positions in whole pixels (ruler, image drag, `dblclickText`) | Firefox and WebKit move the mouse to whole pixels; a double-click past the end of a line selects different text in each browser. |
| Dragging an image handle in `images.spec.ts` | Playwright's Firefox reports a mouse outside the window at x 0, so the drag stays inside the window. |
| `placeOf` in `columns-images-tables.spec.ts` | `boundingBox()` of a paragraph broken across columns is its first box in Chrome but all of them in Firefox. |
| Outline colours | Browsers write the `outline` shorthand in different orders; the tests check the longhands. |
| `unique` in `home.spec.ts` | Documents created by the same test in another browser of the run would match the search. |

## Keys right after the editor gets the focus

For 200ms after the editor gets the focus, ProseMirror puts its own selection back when the
browser's moves to the start of the document (it takes that for the browser resetting the
selection on focus), and once more 20ms after the focus. A test that focuses the editor (or closes
something that returns the focus to it) and then moves the cursor calls `selectionSynced` first,
which waits until that time has passed. Firefox and WebKit are fast enough to hit that window
otherwise.
