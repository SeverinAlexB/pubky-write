export const DEFAULT_FONT = "Arial";

export const fontFamilies = [
  "Arial",
  "Comic Sans MS",
  "Courier New",
  "Georgia",
  "Helvetica",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
];

/** The sizes the reference product offers, in points. */
export const fontSizes = [8, 9, 10, 11, 12, 14, 18, 24, 30, 36, 48, 60, 72, 96];

export const MIN_FONT_SIZE = 1;
export const MAX_FONT_SIZE = 400;

/** Point size of each block type when no explicit size is set (matches styles.css). */
export const defaultFontSizes: Record<string, number> = { paragraph: 11, h1: 20, h2: 16, h3: 14 };

/** Reads a stored size such as "11pt" (or "16px" from pasted content) as points. */
export function parseFontSize(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)(pt|px)$/);
  if (!match) return null;
  const size = Number(match[1]);
  return match[2] === "px" ? Math.round(size * 0.75 * 10) / 10 : size;
}

/** The next size in the standard list above or below `size`, like Docs' + and − buttons. */
export function stepFontSize(size: number, direction: 1 | -1): number {
  if (direction === 1) return fontSizes.find((candidate) => candidate > size) ?? Math.min(size + 1, MAX_FONT_SIZE);
  return [...fontSizes].reverse().find((candidate) => candidate < size) ?? Math.max(size - 1, MIN_FONT_SIZE);
}

export function clampFontSize(size: number): number {
  return Math.min(Math.max(Math.round(size), MIN_FONT_SIZE), MAX_FONT_SIZE);
}
