# Design: everyday editing

Our own design for spec 17: automatic formatting and its preferences, the keyboard shortcut
registry, the link bubble, paste cleanup and edits kept while offline.

## Automatic formatting

`client/src/editor/autoformatRules.ts` is a pure function: given the paragraph's text before the
cursor, the character just typed ("" for Enter), the preferences and a little context (does the
text start at the paragraph start, is it a plain paragraph outside lists, is the cursor at the
paragraph end), it returns at most one change: replace a range of text, link a range, turn the
paragraph into a heading, list, quote or code block, format the text between Markdown delimiters,
or insert a horizontal line. Earlier rules win: block markers, `---`, Markdown emphasis, smart
quotes, substitutions, links, then capitals.

`autoformat.ts` applies it from `handleTextInput` (and `handleKeyDown` for Enter). Keystrokes of
letters and digits return at once, so ordinary typing costs nothing. When a rule matches:

1. the typed character is inserted by an ordinary transaction (so in Suggesting mode it becomes
   part of the current suggestion as usual), then
2. the change follows as a second transaction with `closeHistory`, which starts a new undo step.

So ⌘Z right after an automatic change undoes only the change and leaves exactly what was typed
(`(c)` instead of `©`, `"` instead of `“`, `1. ` instead of a list). Redo applies it again. The
editors of headers, footers and footnotes use the same extension; their undo goes to the main
editor, which starts a new undo group for a transaction marked `autoformat`.

The text the rules read leaves out text suggested for deletion and reads other inline content
(tabs, footnote references) as one object character; an array maps each character back to its
document position. Code blocks and inline code are left alone.

Substitutions are replaced either as soon as their last character is typed or when the word is
completed. A pair is replaced at once when it ends in a symbol and no other pair starts with it
(`-->`, `...`, `(c)`); otherwise (`--`, `tm`, `1/2`) it waits for a space, punctuation or Enter,
so `---` and `-->` can still be typed and `1/25` is not turned into `½5`. Pairs starting with a
letter or digit are only replaced as whole words.

Tiptap's own input rules are switched off (`enableInputRules: false`) and the link extension's
autolink is off (`autolink: false` in the shared schema, which also makes links non-inclusive), so
every automatic change goes through the preferences.

### Suggesting mode

A Markdown shortcut both deletes text (the delimiters) and formats text (the bold). The suggesting
rewrite handles a transaction either as a content change or as a format change, so a mixed one
would lose its formatting. `suggestParts` (in `suggesting.ts`) builds the change from parts, each
rewritten on its own on the result of the previous ones, and combines them into one transaction
that the dispatch hook passes through unchanged (marked as rewritten). Delimiters that are pending
insertions of the same author are deleted outright, the formatting of pending insertions is
applied directly, and a heading or list started in Suggesting mode records the paragraph's format
before it as a paragraph format suggestion.

## Preferences

`preferences.ts` keeps the General checkboxes and the substitutions list in `localStorage`
(`docs.preferences`), merged over the defaults so new options keep their default and malformed
values are ignored. The rules read the preferences on each keystroke that may trigger them; a
`storage` event updates other tabs. The dialog (`PreferencesDialog.tsx`) edits a copy; OK saves.
The Substitutions list always has an empty row at the top; typing into it turns it into a pair
(the row keeps its React key, so the field keeps the focus) and a new empty row appears above.

## Keyboard shortcuts

`client/src/shortcuts.ts` is the one list of shortcuts: name, group, keys written as on macOS
(`"⌘+Shift+X"`, chords as two combinations), and where the shortcut is handled:

| Handled by | How the registry is used |
| --- | --- |
| `editor` | Key bindings that the editor's extensions define use `keyBinding(id)`; for bindings that Tiptap's extensions define themselves (⌘B), a unit test checks every `editor` shortcut against the keymaps the extensions really register. |
| `window` | `DocumentEditor` has a `Record<WindowShortcutId, action>`, so TypeScript requires an action (or `null` while the feature is missing) for each, and its key handler matches events with `matchesShortcut` and `chordSteps`. |
| `browser` | Clipboard and printing, listed for completeness. |

Menus show `shortcutText(id)`, tooltips `withShortcut(name, id)`, and the dialog (`⌘+/`, Tools >
Keyboard shortcuts) lists every available shortcut by group with key caps from `keyCaps(id)`.
Shortcuts of features that are not built yet are marked `unavailable` and left out of the dialog.

## Link bubble

`LinkBubble.tsx` is placed in the page column like the comment pill and shown while the editor has
focus and the selection is inside a link (`getMarkRange`). Typing (a transaction that changes the
document) or Escape hides it until the cursor moves or the user clicks again. The site icon is the
host's `/favicon.ico`, with a globe icon when it fails to load.

The page title is fetched by the server: `GET /api/link-preview?url=` (`server/src/remote.ts`).
Only `http` and `https` addresses on the standard ports, without credentials, are fetched. Host
names are resolved with a lookup that refuses the request if any address is loopback, private,
link-local, multicast or otherwise not public (`net.BlockList`), so DNS cannot point the server at
itself; literal IPs are checked the same way, and every redirect (at most three) is checked again.
Requests time out after 4 seconds and read at most 256 KB. Titles (and pages without one) are
cached in memory for an hour (failures for 5 minutes, at most 500 entries). The client caches the
answer per address. `REMOTE_FETCH_ALLOW_PRIVATE=1` lifts the address checks for the end-to-end
tests, which serve the "remote" image from the test server.

## Paste

`paste.ts`:

- `transformPastedHTML` cleans clipboard HTML that does not come from the editor itself (which is
  recognised by ProseMirror's `data-pm-slice` and kept as it is): comments (including Word's
  conditional comments), scripts, styles and other non-content elements are removed, `o:p` is
  dropped and other Office elements and `font` are unwrapped; classes, ids and `lang` are removed.
  Styles are reduced to basic text formatting and alignment, without font families and sizes equal
  to the defaults (Arial, 11pt) and without background colours on blocks. Word list paragraphs
  (`mso-list: l0 level2 lfo1`, with the bullet or number as text in a `mso-list: Ignore` span)
  become nested `ul`/`ol` lists, numbered when the marker is a number or letter. `MsoTitle` and
  `MsoSubtitle` paragraphs keep their styles.
- `transformPasted`: pasted into an empty paragraph, the first pasted block is inserted whole, so
  a pasted title or heading keeps its style instead of taking the empty paragraph's.
- `clipboardTextParser`: plain text (⌘+Shift+V, where ProseMirror ignores the HTML, or text
  without HTML) becomes paragraphs with the formatting at the cursor.
- Images: web (`http`, `https`) and data (`data:image/…;base64`) images get a `pending:<id>` src
  while they are uploaded (data images through `POST /api/uploads`, web images through
  `POST /api/uploads/remote`, which fetches them with the same protections as the link titles,
  checks the type and stores them like any upload). The image view shows a grey box of the
  image's size (240 × 160 when unknown) for a pending src. When the upload is done, the src is
  replaced in a transaction that is not an undo step; an `appendTransaction` puts the upload back
  if undo and redo bring back the placeholder. A failed upload removes the image and shows a
  message. Images from other sources (local files) are dropped.
- A URL pasted onto selected text links it: the link extension's `linkOnPaste`.

## Offline and unsaved changes

Edits not yet confirmed by the server are kept in IndexedDB (`docs-offline`, store
`pendingSteps`, `pendingSteps.ts`), one entry per document and editor session (the collab client
id): the server version the steps are built on, the steps as JSON, the document's text and the
time.

**When it is written.** `DocumentSync` awaits `persist` at the start of every flush, before it
sends a batch, and it writes the current unconfirmed steps (or removes the entry when there are
none). A second, debounced save (1 s after typing pauses) also stores the document's text, but
only while there are unconfirmed steps, so normal saving does not compute the text. Each write
reads the editor state synchronously and IndexedDB runs transactions in the order they are made,
so the last write is always the latest state.

**Ownership.** Each open editor holds a Web Lock named after its entry. An entry whose lock is
free belongs to a session that has ended. When a document opens (and when the browser comes back
online), the editor restores such entries, holding their lock while it does, so two tabs do not
restore the same entry.

**Restoring.** With the sync paused (`exclusive`), the editor ends the entry's session on the
server and gets the steps since the entry's version in the same request
(`POST /api/documents/:id/sessions/:clientId/end`, `endSession` in `documents.ts`). From then on
the server refuses that session's batches: a batch the closed tab sent just before it closed is
either among the returned steps or never applied, so it cannot land after the restore has decided
what to send again (the property tests found it applied twice otherwise). The editor catches up
with any steps it has not seen
(`receiveTransaction`), and rebases the entry's steps over the server's newer steps and its own
unsaved steps (`rebasePending`, the same mapping prosemirror-collab uses). The rebased steps are
applied as raw steps (not an undo step, not rewritten into suggestions), and in one IndexedDB
transaction the old entry is removed and this session's entry written (or, with nothing left
unsaved, this session's own earlier entry removed as well). The sync then sends them.
`restoreEntry` in `pendingSteps.ts` does all of this, so the property tests run the same code.

**No edit is applied twice.** The kept version is always the version the batch in flight is built
on, because the entry is written before each batch is sent. If the tab closes after the server
accepted a batch but before the editor heard back, the server's steps right after the kept version
start with that batch, stored with the session's client id. `rebasePending` skips the leading
server steps from the entry's client (they are a prefix of the kept steps, since a batch is always
the first unconfirmed steps and is applied whole) and rebases only the rest. In a running session
the same case (the answer to a batch is lost and it is sent again) is recognised by the server:
`applySteps` answers `alreadyApplied` when the steps right after the batch's version are exactly
the batch, from the same client, so the client treats it as accepted. Otherwise it is a normal
conflict, and the collab plugin confirms the client's own steps by their client id.

**Rebasing.** `collab.ts` is prosemirror-collab with two changes the property tests
(`tests/property/`) called for. Unconfirmed steps keep exact inverses: a mark step rebased over
text that already has the mark is undone by restoring each part's marks (`RestoreMarksStep`, a
step that never leaves the editor) instead of removing the mark from all of it, which lost another
session's formatting. And when a rebased step no longer applies and is dropped, the undo and redo
steps after it are dropped too, since one of them may be its undo (which re-inserted its text a
second time). Comment anchors in the editor are kept as of the confirmed version and moved through
the confirmed steps in the server's order (`commentAnchors.ts`), so they end where the server's
do even when rebasing maps a range differently.

**Offline indicator.** A failed request (or the browser's `offline` event) sets the save status to
offline: the indicator shows a cloud-off icon and "Offline – changes will be saved when you
reconnect", and the first time in a page's life a snackbar says so (with Dismiss). The `online`
event retries at once and restores kept entries.

**When restoring fails.** If the stored steps no longer parse, the server refuses the request
(for example the document was deleted) or some steps no longer apply, a dialog offers to download
the unsaved text (the document's text kept with the entry, or the text the steps insert) or to
discard it. A document that no longer exists shows the same dialog on its "Document not found"
page.

## Known limits

- Pasted images that are still uploading when the tab closes stay as grey placeholders.
- Placeholders of pasted images are drawn only in the body; in headers and footers a pending image
  shows as a broken image until it is uploaded.
- "a. " starts the closest numbered preset ("A. a. i."), as there is no lower-case letter preset;
  "- " and "* " both start the first bullet preset.
- The Emoji colon picker (P2) and spelling correction are not built.
