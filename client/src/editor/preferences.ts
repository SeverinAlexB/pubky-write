// Tools > Preferences: the automatic formatting settings, kept in the browser for this user.
// The editor reads them on every keystroke that could trigger an automatic change, so a change
// applies at once to every open editor (and to other tabs, through the storage event).

export type Substitution = { replace: string; with: string; enabled: boolean };

export type Preferences = {
  autoCapitalise: boolean;
  smartQuotes: boolean;
  autoLinks: boolean;
  autoLists: boolean;
  markdown: boolean;
  linkDetails: boolean;
  /** The colon picker: `:smi` shows matching emoji (spec 20). */
  emojiColon: boolean;
  substitutionsEnabled: boolean;
  substitutions: Substitution[];
};

const STORAGE_KEY = "docs.preferences";

const defaultPairs: [string, string][] = [
  ["(c)", "©"],
  ["(r)", "®"],
  ["tm", "™"],
  ["c/o", "℅"],
  ["...", "…"],
  ["1/2", "½"],
  ["1/3", "⅓"],
  ["1/4", "¼"],
  ["1/5", "⅕"],
  ["1/6", "⅙"],
  ["1/8", "⅛"],
  ["2/3", "⅔"],
  ["3/4", "¾"],
  ["2/5", "⅖"],
  ["3/5", "⅗"],
  ["4/5", "⅘"],
  ["5/6", "⅚"],
  ["3/8", "⅜"],
  ["5/8", "⅝"],
  ["7/8", "⅞"],
  ["<--", "←"],
  ["<==", "⇐"],
  ["<=>", "⇔"],
  ["==>", "⇒"],
  ["-->", "→"],
  ["--", "–"],
  ["---", "—"],
];

export function defaultPreferences(): Preferences {
  return {
    autoCapitalise: true,
    smartQuotes: true,
    autoLinks: true,
    autoLists: true,
    markdown: true,
    linkDetails: true,
    emojiColon: true,
    substitutionsEnabled: true,
    substitutions: defaultPairs.map(([replace, by]) => ({ replace, with: by, enabled: true })),
  };
}

const booleanKeys = [
  "autoCapitalise",
  "smartQuotes",
  "autoLinks",
  "autoLists",
  "markdown",
  "linkDetails",
  "emojiColon",
  "substitutionsEnabled",
] as const;

/** Stored preferences over the defaults; anything missing or malformed keeps its default. */
export function parsePreferences(stored: string | null): Preferences {
  const preferences = defaultPreferences();
  if (!stored) return preferences;
  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    return preferences;
  }
  if (!value || typeof value !== "object") return preferences;
  const record = value as Record<string, unknown>;
  for (const key of booleanKeys) if (typeof record[key] === "boolean") preferences[key] = record[key];
  if (Array.isArray(record.substitutions)) {
    preferences.substitutions = record.substitutions.flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const { replace, with: by, enabled } = row as Record<string, unknown>;
      if (typeof replace !== "string" || typeof by !== "string" || !replace) return [];
      return [{ replace, with: by, enabled: enabled !== false }];
    });
  }
  return preferences;
}

let current: Preferences | null = null;
const listeners = new Set<(preferences: Preferences) => void>();

function storage(): Storage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

export function getPreferences(): Preferences {
  current ??= parsePreferences(storage()?.getItem(STORAGE_KEY) ?? null);
  return current;
}

export function savePreferences(preferences: Preferences): void {
  current = preferences;
  storage()?.setItem(STORAGE_KEY, JSON.stringify(preferences));
  for (const listener of listeners) listener(preferences);
}

export function subscribePreferences(listener: (preferences: Preferences) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    current = parsePreferences(event.newValue);
    for (const listener of listeners) listener(current);
  });
}
