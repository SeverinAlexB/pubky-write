// The automatic changes of Tools > Preferences, as a pure function of the text before the cursor.
// See autoformat.ts for how they are applied to the document.
import { bulletPresets, numberedPresets, type ListKind } from "@docs/shared";
import type { Preferences, Substitution } from "./preferences.ts";

export type BlockChange =
  | { type: "heading"; level: number }
  | { type: "list"; list: Exclude<ListKind, "checklist">; preset: string }
  | { type: "blockquote" }
  | { type: "codeBlock" };

/**
 * Offsets are in `before + typed`. `replace` and `link` cover `from`–`to`; `block` removes the
 * first `markerLength` characters; `mark` removes the delimiters and formats what is between them.
 */
export type AutoChange =
  | { kind: "replace"; from: number; to: number; text: string }
  | { kind: "link"; from: number; to: number; href: string }
  | { kind: "block"; block: BlockChange; markerLength: number }
  | { kind: "mark"; mark: "bold" | "italic" | "strike" | "code"; open: [number, number]; close: [number, number] }
  | { kind: "horizontalRule" };

export type AutoContext = {
  /** `before` starts at the start of the paragraph (it was not shortened). */
  fromStart: boolean;
  /** A plain paragraph outside lists: headings, lists, quotes and code blocks start only there. */
  plainParagraph: boolean;
  /** Nothing follows the cursor in the paragraph. */
  atParagraphEnd: boolean;
};

/** Typed characters that complete a word (besides white space and Enter). */
const COMPLETING_PUNCTUATION = new Set([".", ",", ";", ":", "!", "?", ")", "]", "}", '"', "'", "”", "’"]);
const WORD_CHAR = /[\p{L}\p{N}]/u;
/** Inline content that is not text (tabs, footnote references, page numbers) reads as this character. */
export const OBJECT_CHAR = "￼";

const listMarkers: Record<string, BlockChange> = {
  "1.": { type: "list", list: "numbered", preset: numberedPresets[0]!.id },
  "1)": { type: "list", list: "numbered", preset: numberedPresets[1]!.id },
  // There is no "a. b. c." preset; the closest numbers its first level with letters too.
  "a.": { type: "list", list: "numbered", preset: numberedPresets[3]!.id },
  "A.": { type: "list", list: "numbered", preset: numberedPresets[3]!.id },
  "*": { type: "list", list: "bullet", preset: bulletPresets[0].id },
  "-": { type: "list", list: "bullet", preset: bulletPresets[0].id },
};

/**
 * The automatic change that typing `typed` after `before` makes, or null. `typed` is "" for Enter.
 * At most one change happens per keystroke; earlier rules win.
 */
export function autoChange(before: string, typed: string, preferences: Preferences, context: AutoContext): AutoChange | null {
  const text = before + typed;
  const completing = typed === "" || /^\s$/.test(typed) || COMPLETING_PUNCTUATION.has(typed);

  if (typed === " " && context.fromStart && context.plainParagraph) {
    const block = blockMarker(before, preferences);
    if (block) return { kind: "block", block, markerLength: text.length };
  }
  if (typed === "-" && text === "---" && preferences.markdown && context.fromStart && context.plainParagraph && context.atParagraphEnd) {
    return { kind: "horizontalRule" };
  }
  if (preferences.markdown) {
    const mark = markdownMark(text, typed, context.fromStart);
    if (mark) return mark;
  }
  if (preferences.smartQuotes && (typed === '"' || typed === "'")) {
    return { kind: "replace", from: before.length, to: text.length, text: smartQuote(before, typed, context.fromStart) };
  }
  if (preferences.substitutionsEnabled) {
    const substitution = substitute(before, typed, completing, preferences.substitutions, context.fromStart);
    if (substitution) return substitution;
  }
  const endsWord = typed === "" || /^\s$/.test(typed);
  if (endsWord && preferences.autoLinks) {
    const link = detectLink(before);
    if (link) return link;
  }
  if (endsWord && preferences.autoCapitalise) {
    const capital = capitalise(before, context.fromStart);
    if (capital) return capital;
  }
  return null;
}

function blockMarker(marker: string, preferences: Preferences): BlockChange | null {
  if (preferences.markdown) {
    if (/^#{1,6}$/.test(marker)) return { type: "heading", level: marker.length };
    if (marker === ">") return { type: "blockquote" };
    if (marker === "```") return { type: "codeBlock" };
  }
  if (preferences.autoLists) return listMarkers[marker] ?? null;
  return null;
}

const markRules = [
  { mark: "bold", delimiter: "**" },
  { mark: "strike", delimiter: "~~" },
  { mark: "italic", delimiter: "*" },
  { mark: "code", delimiter: "`" },
] as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `**bold**`, `*italic*`, `~~strike~~` and `` `code` `` when the closing delimiter is typed. */
function markdownMark(text: string, typed: string, fromStart: boolean): AutoChange | null {
  for (const { mark, delimiter } of markRules) {
    if (!delimiter.endsWith(typed) || !text.endsWith(delimiter)) continue;
    const d = escapeRegExp(delimiter);
    const c = escapeRegExp(delimiter[0]!);
    // The opening delimiter follows the start or white space and is not part of a longer run;
    // the content does not start or end with white space.
    const pattern = new RegExp(`(^|[\\s(\\["'“‘])${d}((?!${c})[^\\s${c}](?:[^${c}]*[^\\s${c}])?)${d}$`, "u");
    const match = pattern.exec(text);
    if (!match) continue;
    const openFrom = match.index + match[1]!.length;
    if (openFrom === 0 && !fromStart) continue;
    const innerFrom = openFrom + delimiter.length;
    const innerTo = innerFrom + match[2]!.length;
    return { kind: "mark", mark, open: [openFrom, innerFrom], close: [innerTo, innerTo + delimiter.length] };
  }
  return null;
}

/** “ ” ‘ ’: opening after the start, white space or an opening bracket, otherwise closing. */
function smartQuote(before: string, typed: '"' | "'" | string, fromStart: boolean): string {
  const previous = before[before.length - 1];
  if (typed === "'" && previous !== undefined && WORD_CHAR.test(previous)) return "’";
  const opening = previous === undefined ? fromStart : /[\s([{<“‘—–￼]/u.test(previous);
  if (typed === '"') return opening ? "“" : "”";
  return opening ? "‘" : "’";
}

/**
 * A substitution whose "Replace" text was just completed. Symbol sequences that no other pair
 * extends (`-->`, `...`, `(c)`) are replaced as soon as their last character is typed; the others
 * (`--`, `tm`, `1/2`) when a space, punctuation or Enter follows them.
 */
function substitute(before: string, typed: string, completing: boolean, pairs: Substitution[], fromStart: boolean): AutoChange | null {
  const enabled = pairs.filter((pair) => pair.enabled && pair.replace.length > 0);
  const text = before + typed;
  let best: Substitution | null = null;
  for (const pair of enabled) {
    if (typed === "" || !text.endsWith(pair.replace) || !isImmediate(pair.replace, enabled)) continue;
    if (!startsAtBoundary(text, text.length - pair.replace.length, pair.replace, fromStart)) continue;
    if (!best || pair.replace.length > best.replace.length) best = pair;
  }
  if (best) return { kind: "replace", from: text.length - best.replace.length, to: text.length, text: best.with };
  if (!completing) return null;
  for (const pair of enabled) {
    if (!before.endsWith(pair.replace) || isImmediate(pair.replace, enabled)) continue;
    if (!startsAtBoundary(before, before.length - pair.replace.length, pair.replace, fromStart)) continue;
    if (!best || pair.replace.length > best.replace.length) best = pair;
  }
  if (best) return { kind: "replace", from: before.length - best.replace.length, to: before.length, text: best.with };
  return null;
}

/** Replaced as soon as it is typed: it ends in a symbol and no other pair starts with it. */
export function isImmediate(replace: string, pairs: Substitution[]): boolean {
  if (WORD_CHAR.test(replace[replace.length - 1]!)) return false;
  return !pairs.some((pair) => pair.replace !== replace && pair.replace.startsWith(replace));
}

/** Text starting with a letter or digit is only replaced as a whole word ("tm", not "atm"). */
function startsAtBoundary(text: string, start: number, replace: string, fromStart: boolean): boolean {
  if (!WORD_CHAR.test(replace[0]!)) return true;
  if (start === 0) return fromStart;
  return !WORD_CHAR.test(text[start - 1]!);
}

const TOP_LEVEL_DOMAINS = new Set(
  (
    "com org net edu gov mil int info biz name pro io dev app ai co me tv xyz online site tech blog shop store cloud news " +
    "page link live life world email agency design media studio space website wiki"
  ).split(" "),
);
/** Two-letter endings that are more often file extensions than country domains. */
const FILE_EXTENSIONS = new Set(["md", "py", "rs", "sh", "ts", "js", "cs", "rb", "pl", "hs", "mk", "so", "gz", "db"]);

/** Whether `token` is a web address: `https://…`, `www.…` or a domain like `example.com`. */
export function linkTarget(token: string): string | null {
  if (/^https?:\/\/[^\s/?#]+\.[^\s]+$|^https?:\/\/localhost(:\d+)?(\/\S*)?$/i.test(token)) return token;
  if (/^www\.[^\s.]+\.[^\s]+$/i.test(token)) return `https://${token}`;
  const domain = /^((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+([a-z]{2,63}))(?::\d{1,5})?(?:[/?#]\S*)?$/i.exec(token);
  if (!domain) return null;
  const ending = domain[2]!.toLowerCase();
  const known = TOP_LEVEL_DOMAINS.has(ending) || (ending.length === 2 && !FILE_EXTENSIONS.has(ending));
  return known ? `https://${token}` : null;
}

/** The last word before the cursor (`before` ends where the word ends) with where it starts. */
function lastWord(before: string): { word: string; start: number } | null {
  const match = /[^\s￼]+$/u.exec(before);
  return match ? { word: match[0], start: match.index } : null;
}

function detectLink(before: string): AutoChange | null {
  const last = lastWord(before);
  if (!last) return null;
  // Brackets and punctuation around the address are not part of it.
  const leading = /^[("'“‘[<]*/u.exec(last.word)![0].length;
  const trailing = /[.,;:!?)\]}>'"”’]*$/u.exec(last.word.slice(leading))![0].length;
  const token = last.word.slice(leading, last.word.length - trailing);
  const href = token && linkTarget(token);
  if (!href) return null;
  const from = last.start + leading;
  return { kind: "link", from, to: from + token.length, href };
}

function capitalise(before: string, fromStart: boolean): AutoChange | null {
  const last = lastWord(before);
  if (!last) return null;
  const { word, start } = last;
  if (/[/@]/.test(word) || linkTarget(word.replace(/[.,;:!?]+$/, ""))) return null;
  // "i" on its own, and in "i'm", "i'll", "i'd", "i've".
  if (/^i(?:['’](?:m|ll|d|ve))?[.,;:!?]*$/.test(word)) return { kind: "replace", from: start, to: start + 1, text: "I" };
  if (!/^\p{Ll}[^\p{Lu}\p{N}]*$/u.test(word)) return null;
  const preceding = before.slice(0, start);
  const sentenceStart = /^[\s￼]*$/u.test(preceding) ? fromStart : /[.!?]["'”’)\]]*\s+$/u.test(preceding);
  if (!sentenceStart) return null;
  return { kind: "replace", from: start, to: start + 1, text: word[0]!.toUpperCase() };
}
