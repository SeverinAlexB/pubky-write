// Find and replace: matching, highlighting (as decorations) and replacing.
import { Extension } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export type SearchMatch = { from: number; to: number };

export type SearchState = {
  query: string;
  caseSensitive: boolean;
  matches: SearchMatch[];
  /** Index into `matches` of the highlighted match, or -1 when there are none. */
  current: number;
};

type SearchMeta = Partial<Pick<SearchState, "query" | "caseSensitive" | "current">>;

/** Non-text inline nodes (images, line breaks) count as one character so string offsets equal positions. */
const LEAF_PLACEHOLDER = "￼";

/** Finds `query` in every textblock. Matches never span two paragraphs. */
export function findMatches(doc: Node, query: string, caseSensitive: boolean): SearchMatch[] {
  if (!query) return [];
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: SearchMatch[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const raw = node.textBetween(0, node.content.size, undefined, LEAF_PLACEHOLDER);
    const text = caseSensitive ? raw : raw.toLowerCase();
    for (let index = text.indexOf(needle); index !== -1; index = text.indexOf(needle, index + needle.length)) {
      matches.push({ from: pos + 1 + index, to: pos + 1 + index + needle.length });
    }
    return false;
  });
  return matches;
}

export const searchKey = new PluginKey<SearchState>("search");

const emptySearch: SearchState = { query: "", caseSensitive: false, matches: [], current: -1 };

export function getSearchState(state: EditorState): SearchState {
  return searchKey.getState(state) ?? emptySearch;
}

export function setSearch(tr: Transaction, meta: SearchMeta): Transaction {
  return tr.setMeta(searchKey, meta);
}

/** Moves to the next (or previous) match, selects it and scrolls it into view. */
export function goToMatch(state: EditorState, direction: 1 | -1): Transaction | null {
  const { matches, current } = getSearchState(state);
  if (matches.length === 0) return null;
  const next = (current + direction + matches.length) % matches.length;
  const match = matches[next]!;
  return setSearch(state.tr, { current: next })
    .setSelection(TextSelection.create(state.doc, match.from, match.to))
    .scrollIntoView();
}

export function replaceCurrent(state: EditorState, replacement: string): Transaction | null {
  const { matches, current } = getSearchState(state);
  const match = matches[current];
  if (!match) return null;
  return replace(state.tr, match, replacement);
}

export function replaceAll(state: EditorState, replacement: string): Transaction | null {
  const { matches } = getSearchState(state);
  if (matches.length === 0) return null;
  const tr = state.tr;
  // Replace from the end so earlier positions stay valid.
  for (const match of [...matches].reverse()) replace(tr, match, replacement);
  return tr;
}

function replace(tr: Transaction, match: SearchMatch, replacement: string): Transaction {
  return replacement ? tr.insertText(replacement, match.from, match.to) : tr.delete(match.from, match.to);
}

function nearestMatch(matches: SearchMatch[], position: number): number {
  if (matches.length === 0) return -1;
  const after = matches.findIndex((match) => match.from >= position);
  return after === -1 ? 0 : after;
}

export const Search = Extension.create({
  name: "search",

  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchKey,
        state: {
          init: () => emptySearch,
          apply(tr, previous, _oldState, newState) {
            const meta = tr.getMeta(searchKey) as SearchMeta | undefined;
            if (!meta && !tr.docChanged) return previous;
            const query = meta?.query ?? previous.query;
            const caseSensitive = meta?.caseSensitive ?? previous.caseSensitive;
            const matches = findMatches(newState.doc, query, caseSensitive);
            const searchChanged = query !== previous.query || caseSensitive !== previous.caseSensitive;
            let current = meta?.current ?? previous.current;
            if (searchChanged) current = nearestMatch(matches, newState.selection.from);
            if (current >= matches.length) current = matches.length - 1;
            if (current < 0 && matches.length > 0) current = 0;
            return { query, caseSensitive, matches, current };
          },
        },
        props: {
          decorations(state) {
            const { matches, current } = getSearchState(state);
            if (matches.length === 0) return DecorationSet.empty;
            return DecorationSet.create(
              state.doc,
              matches.map((match, index) =>
                Decoration.inline(match.from, match.to, {
                  class: index === current ? "search-match search-match-current" : "search-match",
                }),
              ),
            );
          },
        },
      }),
    ];
  },
});
