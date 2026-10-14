import { Fragment, useEffect, useId, useRef, useState } from "react";
import { Icon } from "../components/Icon.tsx";
import { keyCaps, shortcutGroups, shortcutList } from "../shortcuts.ts";

/** ⌘+/ and Tools > Keyboard shortcuts: every shortcut of the registry (shortcuts.ts), by group, with a search. */
export function KeyboardShortcutsDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const titleId = useId();
  useEffect(() => {
    dialog.current?.showModal();
    // Opening the dialog focuses its first control (the close button); the search comes first.
    search.current?.focus();
  }, []);

  const words = query.trim().toLowerCase();
  const visible = shortcutList.filter((shortcut) => !shortcut.unavailable && shortcut.name.toLowerCase().includes(words));
  const groups = shortcutGroups
    .map((group) => ({ group, shortcuts: visible.filter((shortcut) => shortcut.group === group) }))
    .filter(({ shortcuts }) => shortcuts.length > 0);

  return (
    <dialog
      ref={dialog}
      className="dialog shortcuts-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="dialog-title-row">
        <h2 id={titleId}>Keyboard shortcuts</h2>
        <button type="button" className="icon-button" aria-label="Close dialogue" data-tooltip="Close dialogue" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <label className="shortcuts-search">
        <Icon name="search" />
        <input
          type="search"
          placeholder="Search"
          ref={search}
          aria-label="Search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {/* Scrolls with the keyboard too (it is a Tab stop). */}
      <div className="shortcuts-list" role="region" aria-label="Shortcuts" tabIndex={0}>
        {groups.length === 0 && <p className="shortcuts-empty">No shortcuts found</p>}
        {groups.map(({ group, shortcuts }) => (
          <section key={group} aria-label={group}>
            <h3>{group}</h3>
            <table>
              <tbody>
                {shortcuts.map((shortcut) => (
                  <tr key={shortcut.id}>
                    <th scope="row">{shortcut.name}</th>
                    <td>
                      {keyCaps(shortcut.id).map((alternative, index) => (
                        <Fragment key={index}>
                          {index > 0 && <span className="key-or">or</span>}
                          {alternative.map((combination, step) => (
                            <Fragment key={step}>
                              {step > 0 && <span className="key-or">then</span>}
                              {combination.map((key) => (
                                <kbd key={key} className="key-cap">
                                  {key}
                                </kbd>
                              ))}
                            </Fragment>
                          ))}
                        </Fragment>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </dialog>
  );
}
