import type { Node } from "@tiptap/pm/model";
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

// Counts per top-level block. Nodes are immutable and an edit keeps the unchanged blocks, so
// recounting after a keystroke only segments the block that changed.
const blockCounts = new WeakMap<Node, TextStats>();
const documentCounts = new WeakMap<Node, TextStats>();
let lastSelection: { doc: Node; from: number; to: number; stats: TextStats } | null = null;

/**
 * Counts of the whole document. Blocks are separated by a line break, which ends a word and is
 * not a character, so the sum of the blocks' counts equals the count of the document's text.
 */
function totalStats(doc: Node): TextStats {
  let total = documentCounts.get(doc);
  if (total) return total;
  total = { words: 0, characters: 0, charactersExcludingSpaces: 0 };
  doc.forEach((block) => {
    let stats = blockCounts.get(block);
    if (!stats) {
      stats = countText(block.textBetween(0, block.content.size, "\n", "\n"));
      blockCounts.set(block, stats);
    }
    total.words += stats.words;
    total.characters += stats.characters;
    total.charactersExcludingSpaces += stats.charactersExcludingSpaces;
  });
  documentCounts.set(doc, total);
  return total;
}

/** Counts for the whole document, and for the selection when there is one. */
export function documentStats(state: EditorState): DocumentStats {
  const { doc, selection } = state;
  const { from, to } = selection;
  let selected: TextStats | null = null;
  if (!selection.empty) {
    if (!(lastSelection && lastSelection.doc === doc && lastSelection.from === from && lastSelection.to === to)) {
      lastSelection = { doc, from, to, stats: countText(doc.textBetween(from, to, "\n", "\n")) };
    }
    selected = lastSelection.stats;
  }
  return { total: totalStats(doc), selected };
}

/** "12", or "3 of 12" with a selection. */
export function formatCount(stats: DocumentStats, key: keyof TextStats): string {
  const total = stats.total[key].toLocaleString();
  return stats.selected ? `${stats.selected[key].toLocaleString()} of ${total}` : total;
}
