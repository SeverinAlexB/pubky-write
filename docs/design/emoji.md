# Design: emoji

Our own design for the emoji part of spec 20: the emoji picker, the colon picker and comment
reactions.

## Data

`scripts/build-emoji.mjs` writes `client/src/editor/emoji/emojiData.json` from the pinned
devDependency **emojibase-data 17.0.0** (MIT licence; its English names and keywords are the
Unicode CLDR annotations). It keeps, in the picker's order:

- the nine categories (emojibase groups; the skin tone and hair components are left out) with the
  spec's names: Smileys and emotions, People, Animals and nature, Food and drink, Travel and places,
  Activities and events, Objects, Symbols, Flags;
- per emoji: the emoji (fully qualified), its name ("Thumbs up"), its keywords other than the
  words of its name, and its five skin tone variants when it has them;
- only emoji of Emoji 15.1 and earlier (1,898), which current systems can draw.

The file is 133 KB (41 KB gzip) and is loaded the first time the picker, the colon picker or a
reaction's name is needed (`emojiData.ts`).

**Search** (`searchEmoji`): every word of the query must start a word of the name or a keyword.
Results are ranked: names that start with the query, then names with words that do, then keywords,
otherwise in the picker's order. So "thumb" gives 👍 👎 first, and ":smi" starts with the smiling
faces.

## The picker

`EmojiPicker.tsx` is one component, in a chunk of its own (13 KB, 5 KB gzip), used for Insert >
Symbols > Emoji (and Ctrl+⌘+Space where the system leaves it to the page), comment reactions (the
button on a message, the chip after the reactions, and the "Add emoji reaction" buttons of the
selection and image pills) and Choose emoji in the tab menu. It is a 370 × 404 dialog in a portal,
below the box it is opened for (above when there is no room), and closes on Escape or a click
outside; the caller puts the focus back.

- A search pill (focused when it opens), the category row (36px icons from Material Symbols, with
  "Scroll to previous" and "Scroll to next" arrows when it does not fit, which happens once
  Recently used is there), and the grid "Browse emoji list" with a section per category: sticky
  uppercase headers and 9 cells of 40px per row. Clicking a category scrolls to its section;
  scrolling selects the category of the section at the top.
- Hovering a cell shows its name (the app's tooltip); ↓ from the search field goes to the first
  cell, the arrow keys move by position in the grid (sections have rows of their own), Enter
  chooses, Enter in the search field chooses the first result.
- Recently used (P2): the last 18 emoji chosen, kept in `localStorage` (`docs.recentEmoji`), as a
  first section with its own category.
- Skin tones (P2): a long press (500 ms) on an emoji that has them shows the emoji and its five
  variants above it.

The grid is plain buttons (about 1,900 of them), drawn once when the picker opens.

## The colon picker

`colonEmoji.ts` is a plugin of the editor (and of the header, footer and footnote editors). After
each change it looks at the text before the cursor: `:` after a space or at the start of the
paragraph, followed by two letters and then letters, digits, `_`, `+` or `-`. While there is such
a match (and Tools > Preferences > "Insert emoji using the colon character" is on, the default),
`ColonPicker.tsx` (loaded the first time) shows up to eight matches with their names under the
cursor, the first highlighted, and tells the plugin which emoji it shows. ↑ and ↓ move the
highlight, Enter or Tab replace the `:query` with the emoji (one ordinary text change, so it is a
suggestion in Suggesting mode), Escape dismisses the list until the colon goes, and a space ends
the match.

## Comment reactions

Reactions are stored on the server per message, in `comment_reactions (id, message_id, emoji,
user, created_at, UNIQUE (message_id, emoji, user))`, deleted with their message (and so with
their thread). Opening the database creates the table if it is not there, so existing databases
get it on the next start. Each message of a thread comes with `reactions: [{ emoji, count, mine }]`
in the order each emoji was first added. Every reaction is by the one local user ("You"), so the
count is 1 and `mine` is true; the model has a `user` column so other users' reactions can be
counted later.

- `POST /api/documents/:id/comments/:commentId/messages/:messageId/reactions` with `{ emoji }`
  adds the user's reaction (adding it twice changes nothing) and returns the thread.
- `DELETE /api/documents/:id/comments/:commentId/messages/:messageId/reactions/:emoji` removes it.
- The emoji must be one emoji (pictographic, regional indicators or a keycap, at most 32 code
  units, no letters, digits or spaces); a message of another thread or document is not found.

In the margin (`CommentMargin.tsx`, `ReactionChips.tsx`) each message of the active card shows an
"Add emoji reaction" button (32px, round) at the right of its text on hover, which opens the picker
under it. The reactions are chips under the message (24px tall, radius 12px, `#c4c7c5` border,
white; the user's own with the primary container background and a primary border) with the emoji
and the count, and on the active card a last small chip that adds another. Clicking a chip of the
active card toggles the user's reaction; its tooltip is "You reacted with :grinning_face:" (the
emoji's name, once the emoji data has loaded). Idle cards and All comments show the chips only.

The "Add emoji reaction" buttons of the selection pill and the image pill (P2 in specs 06 and 11)
start a comment on the selection whose message is the chosen emoji.

## Tab emoji

Choose emoji in a tab's menu opens the same picker under the tab's row; Remove emoji is unchanged.

## Known limits

- Reactions are not exported to Word (Word comments have none) and not copied with the document
  (Make a copy leaves comments out).
- Skin tones are offered by a long press only; the picker does not remember a preferred tone.
