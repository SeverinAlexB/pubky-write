// Every keyboard shortcut of the editor, in one place. Menus, context menus, toolbar tooltips,
// the editor's key bindings, the window-wide shortcuts and the Keyboard shortcuts dialog (⌘+/)
// all read them from here, so what the app shows is what it does.
//
// Keys are written as on macOS, one combination per string with its keys joined by "+"
// ("⌘+Shift+X"); a chord is two combinations separated by a space ("Ctrl+⌘+O Ctrl+⌘+H").
// Elsewhere ⌘ is Ctrl and Option is Alt (Ctrl+⌘ in chords is Ctrl+Alt).

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export const shortcutGroups = ["Text formatting", "Paragraph formatting", "Actions", "Comments", "Menus", "Navigation"] as const;
export type ShortcutGroup = (typeof shortcutGroups)[number];

/**
 * Where a shortcut is handled: by the editor's key bindings (a ProseMirror keymap), by the window
 * key handler of the document page, or by the browser (clipboard, printing).
 */
type HandledBy = "editor" | "window" | "browser";

type ShortcutDefinition = {
  name: string;
  group: ShortcutGroup;
  keys: readonly string[];
  handledBy: HandledBy;
  /** Shown in menus and tooltips, but left out of the dialog while the feature is not available. */
  unavailable?: true;
};

const define = <T extends Record<string, ShortcutDefinition>>(definitions: T) => definitions;

export const shortcutDefinitions = define({
  // Text formatting
  bold: { name: "Bold", group: "Text formatting", keys: ["⌘+B"], handledBy: "editor" },
  italic: { name: "Italic", group: "Text formatting", keys: ["⌘+I"], handledBy: "editor" },
  underline: { name: "Underline", group: "Text formatting", keys: ["⌘+U"], handledBy: "editor" },
  strikethrough: { name: "Strikethrough", group: "Text formatting", keys: ["⌘+Shift+X"], handledBy: "editor" },
  superscript: { name: "Superscript", group: "Text formatting", keys: ["⌘+."], handledBy: "editor" },
  subscript: { name: "Subscript", group: "Text formatting", keys: ["⌘+,"], handledBy: "editor" },
  inlineCode: { name: "Inline code", group: "Text formatting", keys: ["⌘+E"], handledBy: "editor" },
  increaseFontSize: { name: "Increase font size", group: "Text formatting", keys: ["⌘+Shift+."], handledBy: "editor" },
  decreaseFontSize: { name: "Decrease font size", group: "Text formatting", keys: ["⌘+Shift+,"], handledBy: "editor" },
  clearFormatting: { name: "Clear formatting", group: "Text formatting", keys: ["⌘+\\"], handledBy: "editor" },

  // Paragraph formatting
  normalText: { name: "Normal text", group: "Paragraph formatting", keys: ["⌘+Option+0"], handledBy: "editor" },
  heading1: { name: "Heading 1", group: "Paragraph formatting", keys: ["⌘+Option+1"], handledBy: "editor" },
  heading2: { name: "Heading 2", group: "Paragraph formatting", keys: ["⌘+Option+2"], handledBy: "editor" },
  heading3: { name: "Heading 3", group: "Paragraph formatting", keys: ["⌘+Option+3"], handledBy: "editor" },
  heading4: { name: "Heading 4", group: "Paragraph formatting", keys: ["⌘+Option+4"], handledBy: "editor" },
  heading5: { name: "Heading 5", group: "Paragraph formatting", keys: ["⌘+Option+5"], handledBy: "editor" },
  heading6: { name: "Heading 6", group: "Paragraph formatting", keys: ["⌘+Option+6"], handledBy: "editor" },
  alignLeft: { name: "Left align", group: "Paragraph formatting", keys: ["⌘+Shift+L"], handledBy: "editor" },
  alignCenter: { name: "Centre align", group: "Paragraph formatting", keys: ["⌘+Shift+E"], handledBy: "editor" },
  alignRight: { name: "Right align", group: "Paragraph formatting", keys: ["⌘+Shift+R"], handledBy: "editor" },
  alignJustify: { name: "Justify", group: "Paragraph formatting", keys: ["⌘+Shift+J"], handledBy: "editor" },
  numberedList: { name: "Numbered list", group: "Paragraph formatting", keys: ["⌘+Shift+7"], handledBy: "editor" },
  bulletedList: { name: "Bulleted list", group: "Paragraph formatting", keys: ["⌘+Shift+8"], handledBy: "editor" },
  checklist: { name: "Checklist", group: "Paragraph formatting", keys: ["⌘+Shift+9"], handledBy: "editor" },
  increaseIndent: { name: "Increase indent", group: "Paragraph formatting", keys: ["⌘+]"], handledBy: "editor" },
  decreaseIndent: { name: "Decrease indent", group: "Paragraph formatting", keys: ["⌘+["], handledBy: "editor" },
  quote: { name: "Quote", group: "Paragraph formatting", keys: ["⌘+Shift+B"], handledBy: "editor" },
  codeBlock: { name: "Code block", group: "Paragraph formatting", keys: ["⌘+Option+C"], handledBy: "editor" },
  lineBreak: { name: "Line break", group: "Paragraph formatting", keys: ["Shift+Enter"], handledBy: "editor" },
  pageBreak: { name: "Page break", group: "Paragraph formatting", keys: ["⌘+Enter"], handledBy: "editor" },

  // Actions
  undo: { name: "Undo", group: "Actions", keys: ["⌘+Z"], handledBy: "editor" },
  redo: { name: "Redo", group: "Actions", keys: ["⌘+Y", "⌘+Shift+Z"], handledBy: "editor" },
  cut: { name: "Cut", group: "Actions", keys: ["⌘+X"], handledBy: "browser" },
  copy: { name: "Copy", group: "Actions", keys: ["⌘+C"], handledBy: "browser" },
  paste: { name: "Paste", group: "Actions", keys: ["⌘+V"], handledBy: "browser" },
  pasteWithoutFormatting: { name: "Paste without formatting", group: "Actions", keys: ["⌘+Shift+V"], handledBy: "browser" },
  selectAll: { name: "Select all", group: "Actions", keys: ["⌘+A"], handledBy: "editor" },
  insertLink: { name: "Insert link", group: "Actions", keys: ["⌘+K"], handledBy: "editor" },
  footnote: { name: "Insert footnote", group: "Actions", keys: ["⌘+Option+F"], handledBy: "editor" },
  header: { name: "Insert or edit header", group: "Actions", keys: ["Ctrl+⌘+O Ctrl+⌘+H"], handledBy: "window" },
  footer: { name: "Insert or edit footer", group: "Actions", keys: ["Ctrl+⌘+O Ctrl+⌘+F"], handledBy: "window" },
  find: { name: "Find", group: "Actions", keys: ["⌘+F"], handledBy: "window" },
  findAndReplace: { name: "Find and replace", group: "Actions", keys: ["⌘+Shift+H"], handledBy: "window" },
  wordCount: { name: "Word count", group: "Actions", keys: ["⌘+Shift+C"], handledBy: "window" },
  print: { name: "Print", group: "Actions", keys: ["⌘+P"], handledBy: "browser" },
  open: { name: "Open", group: "Actions", keys: ["⌘+O"], handledBy: "window" },
  versionHistory: { name: "See version history", group: "Actions", keys: ["⌘+Option+Shift+H"], handledBy: "window" },
  toggleSuggesting: { name: "Switch between suggesting and editing", group: "Actions", keys: ["⌘+Option+Shift+X"], handledBy: "window" },
  editingMode: { name: "Editing mode", group: "Actions", keys: ["⌘+Option+Shift+Z"], handledBy: "window" },
  viewingMode: { name: "Viewing mode", group: "Actions", keys: ["⌘+Option+Shift+C"], handledBy: "window" },
  reviewSuggestions: { name: "Review suggested edits", group: "Actions", keys: ["Ctrl+⌘+O Ctrl+⌘+U"], handledBy: "window" },
  keyboardShortcuts: { name: "Keyboard shortcuts", group: "Actions", keys: ["⌘+/"], handledBy: "window" },
  emoji: { name: "Insert emoji", group: "Actions", keys: ["Ctrl+⌘+Space"], handledBy: "window" },

  // Comments
  addComment: { name: "Add comment", group: "Comments", keys: ["⌘+Option+M"], handledBy: "editor" },
  showAllComments: { name: "Show all comments", group: "Comments", keys: ["⌘+Option+Shift+A"], handledBy: "window" },
  hideComments: { name: "Hide comments", group: "Comments", keys: ["⌘+Option+Shift+J"], handledBy: "window" },

  // Menus
  hideMenus: { name: "Hide the menus", group: "Menus", keys: ["⌘+Shift+F"], handledBy: "window" },
  searchMenus: { name: "Search the menus", group: "Menus", keys: ["Option+/"], handledBy: "window", unavailable: true },
  nonPrintingCharacters: {
    name: "Show non-printing characters",
    group: "Menus",
    keys: ["⌘+Shift+P"],
    handledBy: "window",
    unavailable: true,
  },

  // Navigation
  focusToolbar: { name: "Move to the toolbar", group: "Navigation", keys: ["Option+F10"], handledBy: "window" },
  tab: { name: "Insert a tab, or indent a list item", group: "Navigation", keys: ["Tab"], handledBy: "editor" },
  untab: { name: "Outdent a list item", group: "Navigation", keys: ["Shift+Tab"], handledBy: "editor" },
});

export type ShortcutId = keyof typeof shortcutDefinitions;
export type Shortcut = ShortcutDefinition & { id: ShortcutId };
export type WindowShortcutId = {
  [Id in ShortcutId]: (typeof shortcutDefinitions)[Id]["handledBy"] extends "window" ? Id : never;
}[ShortcutId];

/** All shortcuts in registry order. */
export const shortcutList: Shortcut[] = (Object.keys(shortcutDefinitions) as ShortcutId[]).map((id) => ({
  id,
  ...(shortcutDefinitions[id] as ShortcutDefinition),
}));

const MODIFIERS = new Set(["Ctrl", "⌘", "Option", "Shift"]);

function combinationKeys(combination: string): string[] {
  // "⌘++" is not used, so "+" separates keys.
  return combination.split("+");
}

/** The keys of one combination as shown on this platform: ["⌘", "Shift", "X"] or ["Ctrl", "Shift", "X"]. */
export function platformKeys(combination: string, mac = isMac): string[] {
  const keys = combinationKeys(combination);
  if (mac) return keys;
  // Ctrl+⌘ (chords) is Ctrl+Alt elsewhere.
  if (keys.includes("Ctrl") && keys.includes("⌘")) return keys.map((key) => (key === "⌘" ? "Alt" : key === "Option" ? "Alt" : key));
  return keys.map((key) => (key === "⌘" ? "Ctrl" : key === "Option" ? "Alt" : key));
}

/** One combination as text: "⌘B", "⌘+Shift+X", "Ctrl+⌘O"; elsewhere "Ctrl+B". */
export function combinationText(combination: string, mac = isMac): string {
  const keys = platformKeys(combination, mac);
  let text = "";
  keys.forEach((key, index) => {
    if (index === 0) text = key;
    // ⌘ runs into a letter or digit that follows it, as in macOS menus.
    else if (mac && keys[index - 1] === "⌘" && index === keys.length - 1 && /^[A-Z0-9]$/.test(key)) text += key;
    else text += `+${key}`;
  });
  return text;
}

function sequenceText(keys: string, mac = isMac): string {
  return keys
    .split(" ")
    .map((combination) => combinationText(combination, mac))
    .join(" ");
}

/** The shortcut's first key combination as menus show it: "⌘B", "⌘+Option+M". */
export function shortcutText(id: ShortcutId, mac = isMac): string {
  return sequenceText(shortcutDefinitions[id].keys[0]!, mac);
}

/** Names for keys that read badly in an accessible name. */
const spokenKeys: Record<string, string> = { ",": "comma", ".": "full stop" };

/** A control's name with its shortcut, as shown in tooltips: "Bold (⌘B)". */
export function withShortcut(name: string, id: ShortcutId, mac = isMac): string {
  const text = shortcutDefinitions[id].keys[0]!
    .split(" ")
    .map((combination) => combinationText(combination.replace(/\+([,.])$/, (_match, key: string) => `+${spokenKeys[key]}`), mac))
    .join(" ");
  return `${name} (${text})`;
}

/** The key caps of each alternative: alternatives → combinations of a chord → keys. */
export function keyCaps(id: ShortcutId, mac = isMac): string[][][] {
  return shortcutDefinitions[id].keys.map((keys) => keys.split(" ").map((combination) => platformKeys(combination, mac)));
}

/** ProseMirror key names of every alternative, for a keymap: "⌘+Shift+X" → "Mod-Shift-x". */
export function keyBindings(id: ShortcutId): string[] {
  return shortcutDefinitions[id].keys.filter((keys) => !keys.includes(" ")).map(binding);
}

export function keyBinding(id: ShortcutId): string {
  return keyBindings(id)[0]!;
}

function binding(combination: string): string {
  const keys = combinationKeys(combination);
  const key = keys[keys.length - 1]!;
  const modifiers = keys.slice(0, -1).map((modifier) => ({ "⌘": "Mod", Option: "Alt", Shift: "Shift", Ctrl: "Ctrl" })[modifier]);
  return [...modifiers, /^[A-Z]$/.test(key) ? key.toLowerCase() : key].join("-");
}

const codes: Record<string, string> = {
  "/": "Slash",
  ".": "Period",
  ",": "Comma",
  "[": "BracketLeft",
  "]": "BracketRight",
  "\\": "Backslash",
};

function keyCode(key: string): string {
  if (/^[A-Z]$/.test(key)) return `Key${key}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  return codes[key] ?? key;
}

type KeyEventLike = Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

/** Whether a key event is one combination of a shortcut (the `step`-th of a chord). */
export function matchesCombination(event: KeyEventLike, combination: string, mac = isMac): boolean {
  const keys = combinationKeys(combination);
  const key = keys[keys.length - 1]!;
  if (MODIFIERS.has(key) || event.code !== keyCode(key)) return false;
  const has = (modifier: string) => keys.slice(0, -1).includes(modifier);
  const chord = has("Ctrl") && has("⌘");
  if (event.shiftKey !== has("Shift")) return false;
  if (chord) {
    return mac ? event.metaKey && event.ctrlKey && !event.altKey : event.ctrlKey && event.altKey && !event.metaKey;
  }
  if (event.altKey !== has("Option")) return false;
  // ⌘ is Ctrl elsewhere; on macOS Ctrl is accepted for it too, as the browser's own shortcuts are.
  const mod = has("⌘");
  return mod ? event.metaKey || event.ctrlKey : !event.metaKey && !event.ctrlKey;
}

/** Whether a key event is the shortcut (for chords: their first combination; see `chordSteps`). */
export function matchesShortcut(event: KeyEventLike, id: ShortcutId, mac = isMac): boolean {
  return shortcutDefinitions[id].keys.some((keys) => !keys.includes(" ") && matchesCombination(event, keys, mac));
}

/** The combinations of a chord shortcut, in order. */
export function chordSteps(id: ShortcutId): string[] {
  return shortcutDefinitions[id].keys.find((keys) => keys.includes(" "))?.split(" ") ?? [];
}
