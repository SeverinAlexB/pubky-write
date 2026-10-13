import type { EditorState } from "@tiptap/pm/state";

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

export type DocumentStats = { total: TextStats; selected: TextStats | null };

/** Counts for the whole document, and for the selection when there is one. */
export function documentStats(state: EditorState): DocumentStats {
  const { doc, selection } = state;
  const total = countText(doc.textBetween(0, doc.content.size, "\n", "\n"));
  const selected = selection.empty ? null : countText(doc.textBetween(selection.from, selection.to, "\n", "\n"));
  return { total, selected };
}

/** "12", or "3 of 12" with a selection. */
export function formatCount(stats: DocumentStats, key: keyof TextStats): string {
  const total = stats.total[key].toLocaleString();
  return stats.selected ? `${stats.selected[key].toLocaleString()} of ${total}` : total;
}
