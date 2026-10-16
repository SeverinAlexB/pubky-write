import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "../components/Icon.tsx";
import { getPreferences, savePreferences, type Preferences } from "./preferences.ts";

type Tab = "general" | "substitutions";
const tabs: { id: Tab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "substitutions", label: "Substitutions" },
];

type BooleanPreference = Exclude<keyof Preferences, "substitutions" | "substitutionsEnabled">;
const generalOptions: { key: BooleanPreference; label: string }[] = [
  { key: "autoCapitalise", label: "Automatically capitalise words" },
  { key: "smartQuotes", label: "Use smart quotes" },
  { key: "autoLinks", label: "Automatically detect links" },
  { key: "autoLists", label: "Automatically detect lists" },
  { key: "markdown", label: "Enable Markdown" },
  { key: "linkDetails", label: "Show link details" },
  { key: "emojiColon", label: "Insert emoji using the colon character" },
];

/** A row of the Substitutions list; `key` keeps a row's fields (and focus) while it is edited. */
type Row = { key: number; replace: string; with: string; enabled: boolean };

let nextKey = 0;
const emptyRow = (): Row => ({ key: nextKey++, replace: "", with: "", enabled: true });

/**
 * Tools > Preferences: the General tab's automatic formatting options and the Substitutions tab's
 * Replace / With list. OK saves them for this user (preferences.ts); Cancel leaves them.
 */
export function PreferencesDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const tabButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const [tab, setTab] = useState<Tab>("general");
  const [preferences, setPreferences] = useState(getPreferences);
  // The first row is always empty: typing into it adds a pair, and a new empty row appears above.
  const [rows, setRows] = useState<Row[]>(() => [emptyRow(), ...getPreferences().substitutions.map((pair) => ({ key: nextKey++, ...pair }))]);
  useEffect(() => dialog.current?.showModal(), []);

  const save = () => {
    const substitutions = rows
      .filter((row) => row.replace.trim() !== "")
      .map(({ replace, with: by, enabled }) => ({ replace: replace.trim(), with: by, enabled }));
    savePreferences({ ...preferences, substitutions });
    onClose();
  };

  const updateRow = (key: number, change: Partial<Row>) => {
    setRows((current) => {
      const updated = current.map((row) => (row.key === key ? { ...row, ...change } : row));
      const first = updated[0]!;
      return first.replace || first.with ? [emptyRow(), ...updated] : updated;
    });
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const target = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    const next = (target + tabs.length) % tabs.length;
    setTab(tabs[next]!.id);
    tabButtons.current[next]?.focus();
  };

  return (
    <dialog ref={dialog} className="dialog preferences-dialog" aria-labelledby="preferences-title" onCancel={onClose} onClose={onClose}>
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <h2 id="preferences-title">Preferences</h2>
        <div className="dialog-tabs" role="tablist" aria-label="Preferences">
          {tabs.map(({ id, label }, index) => (
            <button
              key={id}
              ref={(element) => {
                tabButtons.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`preferences-tab-${id}`}
              className="dialog-tab"
              aria-selected={tab === id}
              aria-controls={`preferences-panel-${id}`}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "general" ? (
          <div className="preferences-panel" role="tabpanel" id="preferences-panel-general" aria-labelledby="preferences-tab-general">
            {generalOptions.map(({ key, label }) => (
              <label key={key} className="checkbox-option">
                <input
                  type="checkbox"
                  checked={preferences[key]}
                  onChange={(event) => setPreferences({ ...preferences, [key]: event.target.checked })}
                />
                {label}
              </label>
            ))}
          </div>
        ) : (
          <div
            className="preferences-panel"
            role="tabpanel"
            id="preferences-panel-substitutions"
            aria-labelledby="preferences-tab-substitutions"
          >
            <label className="checkbox-option">
              <input
                type="checkbox"
                checked={preferences.substitutionsEnabled}
                onChange={(event) => setPreferences({ ...preferences, substitutionsEnabled: event.target.checked })}
              />
              Automatic substitution
            </label>
            <table className="substitutions">
              <thead>
                <tr>
                  <th scope="col">
                    <span className="visually-hidden">Enabled</span>
                  </th>
                  <th scope="col">Replace</th>
                  <th scope="col">With</th>
                  <th scope="col">
                    <span className="visually-hidden">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const isNew = index === 0;
                  const name = row.replace || "new substitution";
                  return (
                    <tr key={row.key}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Use ${name}`}
                          checked={row.enabled}
                          disabled={!preferences.substitutionsEnabled}
                          onChange={(event) => updateRow(row.key, { enabled: event.target.checked })}
                        />
                      </td>
                      <td>
                        <input
                          className="substitution-field"
                          aria-label={isNew ? "New replace text" : `Replace ${row.replace}`}
                          value={row.replace}
                          disabled={!preferences.substitutionsEnabled}
                          onChange={(event) => updateRow(row.key, { replace: event.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          className="substitution-field"
                          aria-label={isNew ? "New with text" : `With for ${row.replace}`}
                          value={row.with}
                          disabled={!preferences.substitutionsEnabled}
                          onChange={(event) => updateRow(row.key, { with: event.target.value })}
                        />
                      </td>
                      <td>
                        {!isNew && (
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={`Remove ${name}`}
                            data-tooltip="Remove"
                            disabled={!preferences.substitutionsEnabled}
                            onClick={() => setRows((current) => current.filter((candidate) => candidate.key !== row.key))}
                          >
                            <Icon name="close" size={18} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="dialog-actions">
          <button type="button" className="button-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button-primary">
            OK
          </button>
        </div>
      </form>
    </dialog>
  );
}
