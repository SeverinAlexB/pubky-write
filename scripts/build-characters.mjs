// Generates client/src/editor/characters/characterData.json, the characters and names shown by
// Insert > Symbols > Special characters, from the Unicode Character Database in the pinned
// devDependency @unicode/unicode-16.0.0. Run with `node scripts/build-characters.mjs` after
// changing the categories below.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const UNICODE = "@unicode/unicode-16.0.0";
const load = async (path) => (await import(`${UNICODE}/${path}`)).default;

const names = await load("Names/index.mjs");
const categoryOf = await load("General_Category/index.mjs");
const emojiPresentation = new Set(await load("Binary_Property/Emoji_Presentation/code-points.mjs"));
const block = async (name) => load(`Block/${name}/code-points.mjs`);

/** Words kept capitalised in sentence-case names. */
const properNouns = new Set(["LATIN", "GREEK", "ROMAN", "CYRILLIC", "HEBREW", "ARABIC", "EURO", "CJK", "OCR", "APL", "UK", "US"]);

/** "RIGHTWARDS ARROW" → "Rightwards arrow"; "LATIN CAPITAL LETTER A" → "Latin capital letter A". */
function sentenceCase(name) {
  const words = name.split(" ");
  const capital = /\bCAPITAL\b/.test(name);
  return words
    .map((word, index) => {
      if (properNouns.has(word)) return word.length <= 3 ? word : word[0] + word.slice(1).toLowerCase();
      // The letter itself: "Latin capital letter A", "Latin small letter a".
      if (word.length === 1 && /[A-Z]/.test(word) && index > 0) return capital ? word : word.toLowerCase();
      const lower = word.toLowerCase();
      return index === 0 ? lower[0].toUpperCase() + lower.slice(1) : lower;
    })
    .join(" ");
}

const isVisible = (code) => {
  const category = categoryOf.get(code);
  return category !== undefined && !/^(Control|Format|Unassigned|Private_Use|Surrogate|Space_Separator|Line_Separator|Paragraph_Separator|Nonspacing_Mark|Enclosing_Mark|Spacing_Mark)$/.test(category);
};

function characters(codes, filter = () => true) {
  const seen = new Set();
  const result = [];
  for (const code of codes) {
    if (seen.has(code) || !isVisible(code) || !filter(code)) continue;
    const name = names.get(code);
    if (!name || name.startsWith("<")) continue;
    seen.add(code);
    result.push([code, sentenceCase(name)]);
  }
  return result;
}

const nameMatches = (pattern) => (code) => pattern.test(names.get(code) ?? "");
const inCategory = (...categories) => (code) => categories.includes(categoryOf.get(code));
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, index) => from + index);
const textStyle = (code) => !emojiPresentation.has(code);

const basicLatin = await block("Basic_Latin");
const latin1 = await block("Latin_1_Supplement");
const generalPunctuation = await block("General_Punctuation");
const supplementalPunctuation = await block("Supplemental_Punctuation");
const punctuation = [...basicLatin, ...latin1, ...generalPunctuation, ...supplementalPunctuation];
const symbolBlocks = [
  ...(await block("Miscellaneous_Symbols")),
  ...(await block("Dingbats")),
  ...(await block("Miscellaneous_Symbols_And_Arrows")),
  ...generalPunctuation,
];

const categories = [
  {
    name: "Symbol",
    subcategories: [
      {
        name: "Arrows",
        characters: characters(
          [
            ...(await block("Arrows")),
            ...(await block("Supplemental_Arrows_A")),
            ...(await block("Supplemental_Arrows_B")),
            ...(await block("Miscellaneous_Symbols_And_Arrows")),
            ...(await block("Dingbats")),
          ],
          nameMatches(/ARROW/),
        ),
      },
      { name: "Currency", characters: characters(range(0x20, 0x20c0), inCategory("Currency_Symbol")) },
      { name: "Letterlike", characters: characters(await block("Letterlike_Symbols")) },
      {
        name: "Math",
        characters: characters(
          [...basicLatin, ...latin1, ...(await block("Mathematical_Operators")), ...(await block("Miscellaneous_Mathematical_Symbols_A"))],
          inCategory("Math_Symbol"),
        ),
      },
      {
        name: "Shapes",
        characters: characters([...(await block("Geometric_Shapes")), ...(await block("Block_Elements"))], textStyle),
      },
      { name: "Stars", characters: characters(symbolBlocks, nameMatches(/\b(STAR|ASTERISK|ASTERISM|SPARKLE)/)) },
      { name: "Technical", characters: characters(await block("Miscellaneous_Technical"), textStyle) },
      { name: "Miscellaneous", characters: characters(await block("Miscellaneous_Symbols"), textStyle) },
      { name: "Dingbats", characters: characters(await block("Dingbats"), textStyle) },
    ],
  },
  {
    name: "Punctuation",
    subcategories: [
      { name: "Common", characters: characters([...basicLatin, ...latin1], inCategory("Other_Punctuation", "Connector_Punctuation")) },
      {
        name: "Quotation marks",
        characters: characters(punctuation, (code) => inCategory("Initial_Punctuation", "Final_Punctuation")(code) || nameMatches(/QUOTATION|APOSTROPHE/)(code)),
      },
      { name: "Dashes", characters: characters(punctuation, inCategory("Dash_Punctuation")) },
      { name: "Brackets", characters: characters(punctuation, inCategory("Open_Punctuation", "Close_Punctuation")) },
      { name: "Other", characters: characters([...generalPunctuation, ...supplementalPunctuation], inCategory("Other_Punctuation")) },
    ],
  },
  {
    name: "Emoji",
    subcategories: [
      { name: "Smileys", characters: characters(await block("Emoticons"), (code) => emojiPresentation.has(code)) },
      {
        name: "Nature and objects",
        characters: characters(await block("Miscellaneous_Symbols_And_Pictographs"), (code) => emojiPresentation.has(code)),
      },
      { name: "Travel and places", characters: characters(await block("Transport_And_Map_Symbols"), (code) => emojiPresentation.has(code)) },
      {
        name: "People and activities",
        characters: characters(await block("Supplemental_Symbols_And_Pictographs"), (code) => emojiPresentation.has(code)),
      },
      {
        name: "Symbols",
        characters: characters([...symbolBlocks, ...(await block("Miscellaneous_Technical"))], (code) => emojiPresentation.has(code)),
      },
    ],
  },
  {
    name: "Number",
    subcategories: [
      { name: "Digits", characters: characters(range(0x30, 0x39)) },
      { name: "Fractions", characters: characters(range(0xa0, 0x218f), nameMatches(/FRACTION/)) },
      { name: "Roman numerals", characters: characters(await block("Number_Forms"), nameMatches(/^ROMAN NUMERAL/)) },
      {
        name: "Superscripts and subscripts",
        characters: characters([...latin1, ...(await block("Superscripts_And_Subscripts"))], nameMatches(/^(SUPERSCRIPT|SUBSCRIPT)/)),
      },
      { name: "Circled", characters: characters(await block("Enclosed_Alphanumerics"), inCategory("Other_Number")) },
    ],
  },
  {
    name: "Latin",
    subcategories: [
      { name: "Basic Latin", characters: characters(basicLatin, inCategory("Uppercase_Letter", "Lowercase_Letter")) },
      { name: "Latin-1 Supplement", characters: characters(latin1, inCategory("Uppercase_Letter", "Lowercase_Letter", "Other_Letter")) },
      { name: "Latin Extended-A", characters: characters(await block("Latin_Extended_A")) },
      { name: "Latin Extended-B", characters: characters(await block("Latin_Extended_B")) },
      { name: "IPA Extensions", characters: characters(await block("IPA_Extensions")) },
    ],
  },
];

const output = fileURLToPath(new URL("../client/src/editor/characters/characterData.json", import.meta.url));
const data = { unicodeVersion: "16.0.0", categories };
writeFileSync(output, `${JSON.stringify(data)}\n`);
const total = categories.reduce((sum, category) => sum + category.subcategories.reduce((count, sub) => count + sub.characters.length, 0), 0);
console.log(`Wrote ${total} characters to ${output}`);
for (const category of categories) {
  console.log(`  ${category.name}: ${category.subcategories.map((sub) => `${sub.name} ${sub.characters.length}`).join(", ")}`);
}
