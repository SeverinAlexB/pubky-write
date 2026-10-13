export type TextStats = {
  words: number;
  characters: number;
  charactersExcludingSpaces: number;
};

const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });

/** Counts words with the locale-aware word segmenter, so punctuation and CJK text are handled. */
export function countText(text: string): TextStats {
  let words = 0;
  for (const segment of segmenter.segment(text)) {
    if (segment.isWordLike) words += 1;
  }
  const characters = [...text.replace(/\n/g, "")].length;
  const charactersExcludingSpaces = [...text.replace(/\s/g, "")].length;
  return { words, characters, charactersExcludingSpaces };
}
