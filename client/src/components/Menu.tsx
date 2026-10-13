import { useCallback, useRef, useState, type ReactNode } from "react";
import { MenuList, type MenuEntry } from "./MenuList.tsx";
import { useDismiss } from "./useDismiss.ts";

export type { MenuEntry, MenuItem } from "./MenuList.tsx";

type MenuProps = {
  label: ReactNode;
  entries: MenuEntry[];
  buttonClassName?: string;
  /** The button's accessible name; also shown as its tooltip. */
  ariaLabel?: string;
  listClassName?: string;
  align?: "start" | "end";
  disabled?: boolean;
};

/** A button that opens a dropdown menu; closes on selection, outside click or Escape. */
export function Menu({
  label,
  entries,
  buttonClassName = "menu-button",
  ariaLabel,
  listClassName = "",
  align = "start",
  disabled = false,
}: MenuProps) {
  const [open, setOpen] = useState<{ fromKeyboard: boolean } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(null), []);
  useDismiss(root, open !== null, close);

  return (
    <div className="menu" ref={root}>
      <button
        type="button"
        className={buttonClassName}
        aria-haspopup="menu"
        aria-expanded={open !== null}
        aria-label={ariaLabel}
        data-tooltip={ariaLabel}
        disabled={disabled}
        // Keep the editor selection while the menu is used.
        onMouseDown={(event) => event.preventDefault()}
        // A click from the keyboard (Enter or Space on the button) has no mouse position.
        onClick={(event) => setOpen((value) => (value ? null : { fromKeyboard: event.detail === 0 }))}
      >
        {label}
      </button>
      {open && (
        <MenuList
          entries={entries}
          label={ariaLabel}
          highlightFirst={open.fromKeyboard}
          className={`menu-list-${align} ${listClassName}`}
          onClose={close}
        />
      )}
    </div>
  );
}
