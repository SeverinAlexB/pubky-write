export const DEFAULT_FONT = "Arial";

/** The fonts in the toolbar's Font menu, alphabetically. Roboto and Roboto Mono are bundled. */
export const fontFamilies = [
  "Arial",
  "Arial Black",
  "Comic Sans MS",
  "Courier New",
  "Georgia",
  "Impact",
  "Roboto",
  "Roboto Mono",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
];

const RECENT_FONTS_SETTING = "docs.recentFonts";
const MAX_RECENT_FONTS = 4;

/** The most recently chosen fonts, newest first. */
export function recentFonts(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(RECENT_FONTS_SETTING) ?? "[]");
    return Array.isArray(stored) ? stored.filter((font) => typeof font === "string") : [];
  } catch {
    return [];
  }
}

export function rememberRecentFont(font: string): void {
  const fonts = [font, ...recentFonts().filter((recent) => recent !== font)].slice(0, MAX_RECENT_FONTS);
  localStorage.setItem(RECENT_FONTS_SETTING, JSON.stringify(fonts));
}

/** The standard sizes of the font size list and the + and − buttons, in points. */
export const fontSizes = [8, 9, 10, 11, 12, 14, 18, 24, 30, 36, 48, 60, 72, 96];

export const MIN_FONT_SIZE = 1;
export const MAX_FONT_SIZE = 400;

/** Reads a stored size such as "11pt" (or "16px" from pasted content) as points. */
export function parseFontSize(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)(pt|px)$/);
  if (!match) return null;
  const size = Number(match[1]);
  return match[2] === "px" ? Math.round(size * 0.75 * 10) / 10 : size;
}

/** The next size in the standard list above or below `size`; outside the list it steps by 1. */
export function stepFontSize(size: number, direction: 1 | -1): number {
  if (direction === 1) return fontSizes.find((candidate) => candidate > size) ?? Math.min(size + 1, MAX_FONT_SIZE);
  return [...fontSizes].reverse().find((candidate) => candidate < size) ?? Math.max(size - 1, MIN_FONT_SIZE);
}

export function clampFontSize(size: number): number {
  return Math.min(Math.max(Math.round(size), MIN_FONT_SIZE), MAX_FONT_SIZE);
}
