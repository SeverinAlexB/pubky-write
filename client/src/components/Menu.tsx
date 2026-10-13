import { useCallback, useRef, useState, type ReactNode } from "react";
import { useDismiss } from "./useDismiss.ts";

export type MenuEntry =
  | { label: string; onSelect: () => void; icon?: ReactNode; shortcut?: string; disabled?: boolean; checked?: boolean }
  | "separator";

type MenuProps = {
  label: ReactNode;
  entries: MenuEntry[];
  buttonClassName?: string;
  ariaLabel?: string;
  title?: string;
  align?: "start" | "end";
};

/** A button that opens a dropdown list; closes on selection, outside click or Escape. */
export function Menu({ label, entries, buttonClassName = "menu-button", ariaLabel, title, align = "start" }: MenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useDismiss(root, open, useCallback(() => setOpen(false), []));

  return (
    <div className="menu" ref={root}>
      <button
        type="button"
        className={buttonClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={title}
        // Keep the editor selection while the menu is used.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
      </button>
      {open && (
        <ul className={`menu-list menu-list-${align}`} role="menu">
          {entries.map((entry, index) =>
            entry === "separator" ? (
              <li key={index} className="menu-separator" role="separator" />
            ) : (
              <li key={entry.label} role="none">
                <button
                  type="button"
                  role={entry.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                  aria-checked={entry.checked}
                  className="menu-item"
                  disabled={entry.disabled}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setOpen(false);
                    entry.onSelect();
                  }}
                >
                  <span className="menu-item-icon">{entry.icon}</span>
                  <span className="menu-item-label">{entry.label}</span>
                  {entry.shortcut && <span className="menu-item-shortcut">{entry.shortcut}</span>}
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}
