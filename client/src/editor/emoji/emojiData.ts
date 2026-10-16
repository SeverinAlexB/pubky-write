// The emoji of the emoji picker and the colon picker (emojiData.json, made by
// scripts/build-emoji.mjs from emojibase-data), loaded the first time either is used, and
// searching them by name and keywords.

/** As stored: the emoji, its name, its keywords (space-separated) and its five skin tones, if it has them. */
type StoredEmoji = [emoji: string, name: string, keywords: string, tones?: string[]];
export type EmojiData = { source: string; categories: { id: string; name: string; emoji: StoredEmoji[] }[] };

export type Emoji = { emoji: string; name: string; keywords: string[]; tones: string[] | null; category: string };
export type EmojiCategory = { id: string; name: string; emoji: Emoji[] };

let loaded: EmojiCategory[] | null = null;
let loading: Promise<EmojiCategory[]> | null = null;
let names: Map<string, string> | null = null;

/** Strips variation selectors, so "👍️" and "👍" are the same emoji. */
const bare = (emoji: string) => emoji.replace(/️/g, "");

export function emojiCategories(data: EmojiData): EmojiCategory[] {
  return data.categories.map((category) => ({
    id: category.id,
    name: category.name,
    emoji: category.emoji.map(([emoji, name, keywords, tones]) => ({
      emoji,
      name,
      keywords: keywords ? keywords.split(" ") : [],
      tones: tones ?? null,
      category: category.id,
    })),
  }));
}

export function loadEmoji(): Promise<EmojiCategory[]> {
  loading ??= import("./emojiData.json").then(
    (module) => {
      loaded = emojiCategories(module.default as EmojiData);
      names = new Map();
      for (const category of loaded) {
        for (const entry of category.emoji) {
          names.set(bare(entry.emoji), entry.name);
          for (const tone of entry.tones ?? []) names.set(bare(tone), entry.name);
        }
      }
      return loaded;
    },
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}

/** The emoji, once loaded (null before). */
export function loadedEmoji(): EmojiCategory[] | null {
  return loaded;
}

/** An emoji's name ("Grinning face"), once the data has loaded. */
export function emojiName(emoji: string): string | null {
  return names?.get(bare(emoji)) ?? null;
}

/**
 * The emoji whose name or keywords have words starting with every word of `query`, best first:
 * names that start with the query, then names with a word that does, then keywords; otherwise in
 * the picker's order. "thumb" finds 👍 and 👎; "smi" starts with the smiling faces.
 */
export function searchEmoji(categories: EmojiCategory[], query: string, limit = Infinity): Emoji[] {
  const words = query.toLowerCase().trim().split(/[\s_]+/).filter(Boolean);
  if (words.length === 0) return [];
  const phrase = words.join(" ");
  const ranked: { emoji: Emoji; rank: number; order: number }[] = [];
  let order = 0;
  for (const category of categories) {
    for (const emoji of category.emoji) {
      order++;
      const name = emoji.name.toLowerCase();
      const nameWords = name.split(/[\s:,]+/);
      const matches = (word: string) => nameWords.some((part) => part.startsWith(word)) || emoji.keywords.some((keyword) => keyword.startsWith(word));
      if (!words.every(matches)) continue;
      const rank = name.startsWith(phrase) ? 0 : words.every((word) => nameWords.some((part) => part.startsWith(word))) ? 1 : 2;
      ranked.push({ emoji, rank, order });
    }
  }
  return ranked
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .slice(0, limit)
    .map((entry) => entry.emoji);
}

// Recently used (P2) ----------------------------------------------------------------------------

const RECENT_KEY = "docs.recentEmoji";
const MAX_RECENT = 18;

export function recentEmoji(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string").slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

export function rememberEmoji(emoji: string): void {
  const recent = [emoji, ...recentEmoji().filter((entry) => entry !== emoji)].slice(0, MAX_RECENT);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
}
