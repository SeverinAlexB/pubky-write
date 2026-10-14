import { extensions as coreExtensions, getExtensionField, resolveExtensions, type AnyExtension } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { editorExtensions } from "./editor/extensions.ts";
import {
  chordSteps,
  keyBindings,
  keyCaps,
  matchesCombination,
  matchesShortcut,
  shortcutDefinitions,
  shortcutList,
  shortcutText,
  withShortcut,
} from "./shortcuts.ts";

const event = (code: string, modifiers: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {}) => ({
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...modifiers,
});

describe("shortcut text", () => {
  it("writes shortcuts as menus and tooltips show them on each platform", () => {
    expect(shortcutText("bold", true)).toBe("⌘B");
    expect(shortcutText("bold", false)).toBe("Ctrl+B");
    expect(shortcutText("strikethrough", true)).toBe("⌘+Shift+X");
    expect(shortcutText("addComment", false)).toBe("Ctrl+Alt+M");
    expect(shortcutText("clearFormatting", true)).toBe("⌘+\\");
    expect(shortcutText("header", true)).toBe("Ctrl+⌘O Ctrl+⌘H");
    expect(shortcutText("header", false)).toBe("Ctrl+Alt+O Ctrl+Alt+H");
    expect(withShortcut("Decrease font size", "decreaseFontSize", true)).toBe("Decrease font size (⌘+Shift+comma)");
    expect(withShortcut("Increase font size", "increaseFontSize", false)).toBe("Increase font size (Ctrl+Shift+full stop)");
  });

  it("splits shortcuts into key caps, with alternatives and chords", () => {
    expect(keyCaps("bold", true)).toEqual([[["⌘", "B"]]]);
    expect(keyCaps("redo", false)).toEqual([[["Ctrl", "Y"]], [["Ctrl", "Shift", "Z"]]]);
    expect(keyCaps("reviewSuggestions", true)).toEqual([[["Ctrl", "⌘", "O"], ["Ctrl", "⌘", "U"]]]);
  });
});

describe("matching key events", () => {
  it("matches exact modifiers, with Ctrl for ⌘ elsewhere", () => {
    expect(matchesShortcut(event("KeyH", { metaKey: true, shiftKey: true }), "findAndReplace", true)).toBe(true);
    expect(matchesShortcut(event("KeyH", { metaKey: true, shiftKey: true, altKey: true }), "findAndReplace", true)).toBe(false);
    expect(matchesShortcut(event("KeyH", { metaKey: true, shiftKey: true, altKey: true }), "versionHistory", true)).toBe(true);
    expect(matchesShortcut(event("Slash", { ctrlKey: true }), "keyboardShortcuts", false)).toBe(true);
    expect(matchesShortcut(event("F10", { altKey: true }), "focusToolbar", true)).toBe(true);
    expect(matchesShortcut(event("F10"), "focusToolbar", true)).toBe(false);
  });

  it("matches the steps of a chord", () => {
    const [first, second] = chordSteps("footer");
    expect(matchesCombination(event("KeyO", { metaKey: true, ctrlKey: true }), first!, true)).toBe(true);
    expect(matchesCombination(event("KeyO", { ctrlKey: true, altKey: true }), first!, false)).toBe(true);
    expect(matchesCombination(event("KeyF", { metaKey: true, ctrlKey: true }), second!, true)).toBe(true);
    // ⌘O alone opens the document list, not the chord.
    expect(matchesCombination(event("KeyO", { metaKey: true }), first!, true)).toBe(false);
  });
});

/** The keys bound by the editor's extensions (and Tiptap's own core keymap), normalised. */
function boundKeys(extensions: AnyExtension[]): Set<string> {
  const keys = new Set<string>();
  const stubEditor = { commands: {}, isEditable: true } as never;
  for (const extension of resolveExtensions([coreExtensions.Keymap, ...extensions])) {
    const context = { name: extension.name, options: extension.options, storage: {}, editor: stubEditor, type: null };
    const add = getExtensionField<(() => Record<string, unknown>) | undefined>(extension, "addKeyboardShortcuts", context);
    for (const key of Object.keys(add?.() ?? {})) keys.add(normalise(key));
  }
  return keys;
}

function normalise(key: string): string {
  const parts = key.split("-");
  const name = parts.pop()!;
  return [...parts.sort(), name.length === 1 ? name.toLowerCase() : name].join("-");
}

describe("the registry", () => {
  it("lists every shortcut the editor handles with keys it really binds", () => {
    const bound = boundKeys(
      editorExtensions({
        version: 0,
        clientId: "test",
        onLinkShortcut: () => {},
        onCommentShortcut: () => {},
        onFootnoteShortcut: () => {},
        comments: [],
        commentsHidden: false,
        onCommentClick: () => {},
        mode: "editing",
        onSuggestionClick: () => {},
      }),
    );
    expect(bound.has("Mod-b")).toBe(true);
    expect(bound.has(normalise("Mod-Shift-Alt-q"))).toBe(false);
    const missing = shortcutList
      .filter((shortcut) => shortcut.handledBy === "editor")
      .flatMap((shortcut) => keyBindings(shortcut.id).filter((key) => !bound.has(normalise(key))).map((key) => `${shortcut.id}: ${key}`));
    expect(missing).toEqual([]);
  });

  it("has unique names and keys", () => {
    const names = shortcutList.map((shortcut) => shortcut.name);
    expect(new Set(names).size).toBe(names.length);
    const keys = shortcutList.flatMap((shortcut) => shortcut.keys);
    expect(new Set(keys).size).toBe(keys.length);
    expect(Object.keys(shortcutDefinitions).length).toBe(shortcutList.length);
  });
});
