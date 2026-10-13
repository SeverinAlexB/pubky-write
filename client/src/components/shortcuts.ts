export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * Shortcut text for this platform. Shortcuts are written as on macOS ("⌘B",
 * "⌘+Option+M"); elsewhere ⌘ becomes Ctrl and Option becomes Alt.
 */
export function shortcut(mac: string): string {
  if (isMac) return mac;
  return mac.replace(/⌘\+?/g, "Ctrl+").replace(/Option/g, "Alt");
}

/** A control's name with its shortcut, as shown in tooltips: "Bold (⌘B)". */
export function withShortcut(name: string, mac: string): string {
  return `${name} (${shortcut(mac)})`;
}
