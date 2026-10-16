// Generates client/src/editor/emoji/emojiData.json, the emoji of the emoji picker and the colon
// picker with their names and keywords, from the pinned devDependency emojibase-data (MIT
// licence; its English data is from the Unicode CLDR). Run with `node scripts/build-emoji.mjs`
// after updating emojibase-data.
//
// Emoji newer than MAX_VERSION are left out, as systems from before then cannot draw them.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const MAX_VERSION = 15.1;
const require = createRequire(import.meta.url);
const data = require("emojibase-data/en/data.json");
const { version } = require("emojibase-data/package.json");

/** The picker's nine categories, by emojibase group (2, skin tone and hair components, is left out). */
const categories = [
  { group: 0, id: "smileys", name: "Smileys and emotions" },
  { group: 1, id: "people", name: "People" },
  { group: 3, id: "nature", name: "Animals and nature" },
  { group: 4, id: "food", name: "Food and drink" },
  { group: 5, id: "travel", name: "Travel and places" },
  { group: 6, id: "activities", name: "Activities and events" },
  { group: 7, id: "objects", name: "Objects" },
  { group: 8, id: "symbols", name: "Symbols" },
  { group: 9, id: "flags", name: "Flags" },
];

/** "grinning face" → "Grinning face"; "flag: Switzerland" stays as it is after the first letter. */
const capitalise = (label) => label.charAt(0).toUpperCase() + label.slice(1);

const output = {
  source: `emojibase-data ${version} (MIT)`,
  categories: categories.map(({ group, id, name }) => ({
    id,
    name,
    emoji: data
      .filter((entry) => entry.group === group && entry.version <= MAX_VERSION)
      .sort((a, b) => a.order - b.order)
      .map((entry) => {
        const keywords = (entry.tags ?? []).filter((tag) => !entry.label.toLowerCase().split(/[\s:,]+/).includes(tag)).join(" ");
        const skins = (entry.skins ?? []).filter((skin) => skin.version <= MAX_VERSION && typeof skin.tone === "number");
        // Five skin tones (P2): the variants with one tone, in tone order.
        const tones = skins.length >= 5 ? skins.sort((a, b) => a.tone - b.tone).slice(0, 5).map((skin) => skin.emoji) : null;
        return tones ? [entry.emoji, capitalise(entry.label), keywords, tones] : [entry.emoji, capitalise(entry.label), keywords];
      }),
  })),
};

const target = fileURLToPath(new URL("../client/src/editor/emoji/emojiData.json", import.meta.url));
writeFileSync(target, JSON.stringify(output));
const count = output.categories.reduce((sum, category) => sum + category.emoji.length, 0);
console.log(`Wrote ${count} emoji to ${target} (${readFileSync(target).length} bytes)`);
