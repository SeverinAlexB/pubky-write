// Find and replace: matching, highlighting (as decorations) and replacing.
import { acceptedTextBetween, acceptedTextOffsets } from "@docs/shared";
import { Extension } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { currentTab } from "./documentTabs.ts";
import { clientRect } from "./rects.ts";

export type SearchRange = { from: number; to: number };

export type SearchMatch = SearchRange & {
  /** Numbered capture groups of a regular expression match (index 0 is unused), for `$1` in replacements. */
  groups?: (SearchRange | undefined)[];
  namedGroups?: Record<string, SearchRange | undefined>;
};

export type SearchOptions = {
  query: string;
  caseSensitive: boolean;
  /** The query is a JavaScript regular expression. */
  regex: boolean;
  /** Letters match regardless of accents: ä = a, É = E. */
  ignoreDiacritics: boolean;
};

export type SearchState = SearchOptions & {
  matches: SearchMatch[];
  /** Index into `matches` of the current match, or -1 when there are none. */
  current: number;
  /** Increases whenever the search itself changes, so the current match is scrolled into view. */
  reveal: number;
};

type SearchMeta = Partial<SearchOptions> & { current?: number };

export const defaultSearchOptions: SearchOptions = { query: "", caseSensitive: false, regex: false, ignoreDiacritics: true };

/**
 * Line breaks read as "\n" and tabs as "\t" (so a regular expression can match them); other inline
 * nodes as one placeholder character.
 */
const leafText = (node: Node) => (node.type.name === "hardBreak" ? "\n" : node.type.name === "tab" ? "\t" : "￼");

const combiningMarks = /\p{M}/gu;

function stripDiacritics(text: string): string {
  return text.normalize("NFD").replace(combiningMarks, "");
}

/**
 * Text with diacritics removed, and where each of its UTF-16 units came from in the original.
 * Removing accents changes lengths ("é" can be one or two units, combining marks disappear),
 * so matches found in the folded text are mapped back through `starts` and `ends`.
 */
export type FoldedText = { text: string; starts: number[]; ends: number[] };

export function foldText(raw: string, ignoreDiacritics: boolean): FoldedText {
  if (!ignoreDiacritics) {
    const offsets = Array.from({ length: raw.length }, (_, index) => index);
    return { text: raw, starts: offsets, ends: offsets.map((index) => index + 1) };
  }
  let text = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let index = 0;
  for (const character of raw) {
    const folded = stripDiacritics(character);
    for (let unit = 0; unit < folded.length; unit++) {
      starts.push(index);
      ends.push(index + character.length);
    }
    text += folded;
    index += character.length;
  }
  return { text, starts, ends };
}

/** Maps the folded range [from, to) back to the original text, taking combining marks after the match along. */
export function unfoldRange(folded: FoldedText, rawLength: number, from: number, to: number): SearchRange {
  const start = folded.starts[from]!;
  let end: number;
  if (to >= folded.text.length) end = rawLength;
  // The match ends inside a character that folded into several units: take the whole character.
  else if (folded.starts[to] === folded.starts[to - 1]) end = folded.ends[to - 1]!;
  else end = folded.starts[to]!;
  return { from: start, to: end };
}

/** The search as a global regular expression, or null when the query is empty or not a valid expression. */
export function searchPattern(options: SearchOptions): RegExp | null {
  if (!options.query) return null;
  const query = options.ignoreDiacritics ? stripDiacritics(options.query) : options.query;
  const source = options.regex ? query : query.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");
  try {
    return new RegExp(source, `gd${options.caseSensitive ? "" : "i"}`);
  } catch {
    return null;
  }
}

/**
 * Finds the search in every textblock (of `range`, the shown tab), skipping text suggested for
 * deletion. Matches never span two paragraphs.
 */
export function findMatches(doc: Node, options: SearchOptions, range: SearchRange = { from: 0, to: doc.content.size }): SearchMatch[] {
  const pattern = searchPattern(options);
  if (!pattern) return [];
  const matches: SearchMatch[] = [];
  doc.nodesBetween(range.from, range.to, (node, pos) => {
    // Text in an object suggested for deletion (a table row) is not searched, like deleted text.
    if (!node.isTextblock) return !node.attrs.suggestionDelete;
    const { text: raw, offsets } = acceptedTextOffsets(node, leafText);
    const folded = foldText(raw, options.ignoreDiacritics);
    const start = pos + 1;
    const toDocument = ([from, to]: [number, number]): SearchRange => {
      const range = unfoldRange(folded, raw.length, from, to);
      if (!offsets) return { from: start + range.from, to: start + range.to };
      return { from: start + offsets[range.from]!, to: start + offsets[range.to - 1]! + 1 };
    };
    pattern.lastIndex = 0;
    for (let result = pattern.exec(folded.text); result; result = pattern.exec(folded.text)) {
      // Empty matches (such as `a*`) highlight nothing; step past them.
      if (result[0].length === 0) {
        pattern.lastIndex += 1;
        continue;
      }
      const match: SearchMatch = toDocument(result.indices![0]!);
      if (options.regex) {
        match.groups = result.indices!.map((range, index) => (index > 0 && range ? toDocument(range) : undefined));
        const named = result.indices!.groups;
        if (named) {
          match.namedGroups = Object.fromEntries(
            Object.entries(named).map(([name, range]) => [name, range ? toDocument(range) : undefined]),
          );
        }
      }
      matches.push(match);
    }
    return false;
  });
  return matches;
}

/**
 * The replacement text for one match. With regular expressions, `$&`, `$1`–`$99`, `$<name>` and
 * `$$` work as in JavaScript, and groups insert the document's original (unfolded) text.
 */
export function expandReplacement(doc: Node, match: SearchMatch, replacement: string, regex: boolean): string {
  if (!regex) return replacement;
  const text = (range: SearchRange | undefined) => (range ? acceptedTextBetween(doc, range.from, range.to, undefined, leafText) : "");
  const groupCount = (match.groups?.length ?? 1) - 1;
  return replacement.replace(/\$(\$|&|<([^>]*)>|(\d\d?))/g, (token, symbol: string, name?: string, digits?: string) => {
    if (symbol === "$") return "$";
    if (symbol === "&") return text(match);
    if (name !== undefined) return match.namedGroups ? text(match.namedGroups[name]) : token;
    // "$12" means group 12 if there is one, otherwise group 1 followed by "2".
    let number = Number(digits);
    let rest = "";
    if (number > groupCount && digits!.length === 2) {
      number = Number(digits![0]);
      rest = digits![1]!;
    }
    if (number < 1 || number > groupCount) return token;
    return text(match.groups![number]) + rest;
  });
}

export const searchKey = new PluginKey<SearchState>("search");

const emptySearch: SearchState = { ...defaultSearchOptions, matches: [], current: -1, reveal: 0 };

export function getSearchState(state: EditorState): SearchState {
  return searchKey.getState(state) ?? emptySearch;
}

export function setSearch(tr: Transaction, meta: SearchMeta): Transaction {
  return tr.setMeta(searchKey, meta);
}

/** Moves to the next (or previous) match, wrapping around at the ends, and selects it. */
export function goToMatch(state: EditorState, direction: 1 | -1): Transaction | null {
  const { matches, current } = getSearchState(state);
  if (matches.length === 0) return null;
  const next = (current + direction + matches.length) % matches.length;
  const match = matches[next]!;
  return setSearch(state.tr, { current: next }).setSelection(TextSelection.create(state.doc, match.from, match.to));
}

/** Selects the current match, for when the search closes. */
export function selectCurrentMatch(state: EditorState): Transaction | null {
  const { matches, current } = getSearchState(state);
  const match = matches[current];
  return match ? state.tr.setSelection(TextSelection.create(state.doc, match.from, match.to)) : null;
}

/** Replaces the current match and moves to the next one. */
export function replaceCurrent(state: EditorState, replacement: string): Transaction | null {
  const { matches, current, regex } = getSearchState(state);
  const match = matches[current];
  if (!match) return null;
  const tr = replace(state.tr, match, expandReplacement(state.doc, match, replacement, regex));
  // The next match is the first one after the replaced text.
  const after = tr.mapping.map(match.to);
  return tr.setSelection(TextSelection.create(tr.doc, after)).setMeta(searchKey, { after } satisfies ApplyMeta);
}

/** Replaces every match in one transaction, so it is one undo step. */
export function replaceAll(state: EditorState, replacement: string): Transaction | null {
  const { matches, regex } = getSearchState(state);
  if (matches.length === 0) return null;
  const texts = matches.map((match) => expandReplacement(state.doc, match, replacement, regex));
  const tr = state.tr;
  // Replace from the end so earlier positions stay valid.
  for (let index = matches.length - 1; index >= 0; index--) replace(tr, matches[index]!, texts[index]!);
  return tr;
}

function replace(tr: Transaction, match: SearchRange, text: string): Transaction {
  return text ? tr.insertText(text, match.from, match.to) : tr.delete(match.from, match.to);
}

/** The first match at or after `position`, wrapping around to the first. */
function matchAtOrAfter(matches: SearchMatch[], position: number): number {
  if (matches.length === 0) return -1;
  const after = matches.findIndex((match) => match.from >= position);
  return after === -1 ? 0 : after;
}

/** Internal meta of a replacement: the current match becomes the first one after `after`. */
type ApplyMeta = { after: number };

export const Search = Extension.create({
  name: "search",

  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchKey,
        state: {
          init: () => emptySearch,
          apply(tr, previous, oldState, newState) {
            const meta = tr.getMeta(searchKey) as (SearchMeta & Partial<ApplyMeta>) | undefined;
            const tab = currentTab(newState);
            // Find searches the shown tab.
            const tabChanged = tab.id !== currentTab(oldState).id;
            if (!meta && !tr.docChanged && !tabChanged) return previous;
            const options: SearchOptions = {
              query: meta?.query ?? previous.query,
              caseSensitive: meta?.caseSensitive ?? previous.caseSensitive,
              regex: meta?.regex ?? previous.regex,
              ignoreDiacritics: meta?.ignoreDiacritics ?? previous.ignoreDiacritics,
            };
            const matches = findMatches(newState.doc, options, tab);
            const searchChanged = (Object.keys(defaultSearchOptions) as (keyof SearchOptions)[]).some(
              (key) => options[key] !== previous[key],
            );
            let current = meta?.current ?? previous.current;
            if (meta?.after !== undefined) current = matchAtOrAfter(matches, meta.after);
            else if (searchChanged || tabChanged) current = matchAtOrAfter(matches, newState.selection.from);
            if (current >= matches.length) current = matches.length - 1;
            if (current < 0 && matches.length > 0) current = 0;
            const reveal = meta ? previous.reveal + 1 : previous.reveal;
            return { ...options, matches, current, reveal };
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
        view: () => ({
          update(view, previousState) {
            const search = getSearchState(view.state);
            if (search.reveal !== getSearchState(previousState).reveal) revealCurrentMatch(view);
          },
        }),
      }),
    ];
  },
});

/**
 * Scrolls the current match to the middle of the editor area if it is not visible. Works on the
 * rendered highlight, so page spacers and zoom are already applied.
 */
function revealCurrentMatch(view: EditorView): void {
  const element = view.dom.querySelector(".search-match-current");
  if (!element) return;
  const rect = clientRect(element);
  const scroller = view.dom.closest(".editor-scroll");
  const area = scroller?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };
  if (rect.top >= area.top && rect.bottom <= area.bottom) return;
  element.scrollIntoView({ block: "center", inline: "nearest" });
}
