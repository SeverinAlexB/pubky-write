// The character data of Insert > Symbols > Special characters (characterData.json, made by
// scripts/build-characters.mjs) and searching it by keyword or code point.

/** A code point and its Unicode name in sentence case. */
export type CharacterEntry = [code: number, name: string];
export type CharacterSubcategory = { name: string; characters: CharacterEntry[] };
export type CharacterCategory = { name: string; subcategories: CharacterSubcategory[] };
export type CharacterData = { unicodeVersion: string; categories: CharacterCategory[] };

export type CharacterInfo = { code: number; char: string; name: string };

const MAX_CODE_POINT = 0x10ffff;
const MAX_RESULTS = 500;

/** "U+2192" for 0x2192. */
export function codePointLabel(code: number): string {
  return `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
}

export function toInfo([code, name]: CharacterEntry): CharacterInfo {
  return { code, char: String.fromCodePoint(code), name };
}

/**
 * A query that names a code point: "U+2192", "u+1f600", or bare hex with at least one digit
 * ("2192"), so that words such as "face" or "cafe" stay keyword searches.
 */
export function parseCodePoint(query: string): number | null {
  const match = query.trim().match(/^(u\+|0x)?([0-9a-f]{2,6})$/i);
  if (!match) return null;
  const [, prefix, hex] = match;
  if (!prefix && (!/\d/.test(hex!) || hex!.length < 4)) return null;
  const code = Number.parseInt(hex!, 16);
  if (code > MAX_CODE_POINT || (code >= 0xd800 && code <= 0xdfff)) return null;
  return code;
}

/**
 * Characters of every category whose name contains all the words of `query` (each at the start
 * of a word of the name), in category order without duplicates. A code point query puts that
 * character first, even when it is not in the bundled categories.
 */
export function searchCharacters(data: CharacterData, query: string): CharacterInfo[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [];
  const results: CharacterInfo[] = [];
  const seen = new Set<number>();
  const add = (info: CharacterInfo) => {
    if (seen.has(info.code) || results.length >= MAX_RESULTS) return;
    seen.add(info.code);
    results.push(info);
  };

  const code = parseCodePoint(trimmed);
  if (code !== null) add(findCharacter(data, code) ?? { code, char: String.fromCodePoint(code), name: "" });

  const words = trimmed.split(/\s+/).filter((word) => !/^u\+/.test(word));
  if (words.length === 0) return results;
  for (const category of data.categories) {
    for (const subcategory of category.subcategories) {
      for (const entry of subcategory.characters) {
        if (seen.has(entry[0])) continue;
        const nameWords = entry[1].toLowerCase().split(/[\s-]+/);
        if (words.every((word) => nameWords.some((nameWord) => nameWord.startsWith(word)))) {
          add(toInfo(entry));
        }
      }
    }
  }
  return results;
}

export function findCharacter(data: CharacterData, code: number): CharacterInfo | null {
  for (const category of data.categories) {
    for (const subcategory of category.subcategories) {
      const entry = subcategory.characters.find(([candidate]) => candidate === code);
      if (entry) return toInfo(entry);
    }
  }
  return null;
}
