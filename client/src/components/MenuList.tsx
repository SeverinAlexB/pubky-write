import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Icon, type IconName } from "./Icon.tsx";

export type MenuItem = {
  /** The item's text and accessible name. */
  label: string;
  /** Shown instead of the plain label, for example a style preview or a font in its own typeface. */
  content?: ReactNode;
  icon?: IconName;
  shortcut?: string;
  /** Missing for features that are not built yet: the item is then shown disabled. */
  onSelect?: () => void;
  disabled?: boolean;
  /** Makes the item a toggle, with a check mark in the icon column when on. */
  checked?: boolean;
  submenu?: MenuEntry[];
  /** Custom submenu content, such as the table size grid. Receives a function that closes all menus. */
  panel?: (close: () => void) => ReactNode;
};

export type MenuEntry = MenuItem | "separator" | { heading: string };

type MenuListProps = {
  entries: MenuEntry[];
  /** Closes every open menu: called after an item is chosen, and on Escape or Tab. */
  onClose: () => void;
  /** ← in a submenu closes it; in a menu bar menu ← and → move to the neighbouring menu. */
  onLeft?: () => void;
  onRight?: () => void;
  /** Highlights the first item, for menus opened from the keyboard. */
  highlightFirst?: boolean;
  isSubmenu?: boolean;
  label?: string;
  className?: string;
  /** Opens the menu at a point of the window (a right-click), flipped to stay inside it. */
  at?: { x: number; y: number };
};

/**
 * A dropdown menu. Keyboard focus stays where it was (usually the document, so the
 * selection stays visible); the open menu handles ↑ ↓ ← → Enter and Escape itself.
 */
export function MenuList({
  entries,
  onClose,
  onLeft,
  onRight,
  highlightFirst = false,
  isSubmenu = false,
  label,
  className = "",
  at,
}: MenuListProps) {
  const choosable = entries.flatMap((entry, index) => (isItem(entry) && !isDisabled(entry) ? [index] : []));
  const [active, setActive] = useState<number | null>(highlightFirst ? (choosable[0] ?? null) : null);
  const [open, setOpen] = useState<{ index: number; fromKeyboard: boolean } | null>(null);
  const list = useRef<HTMLUListElement>(null);
  useFitInViewport(list, isSubmenu, at);

  const openItem = open ? (entries[open.index] as MenuItem) : null;

  function choose(index: number, fromKeyboard: boolean) {
    const entry = entries[index] as MenuItem;
    // An item with both an action and a submenu (like a paragraph style) runs the action.
    if (hasSubmenu(entry) && !entry.onSelect) return setOpen({ index, fromKeyboard });
    onClose();
    entry.onSelect?.();
  }

  function move(step: 1 | -1) {
    if (choosable.length === 0) return;
    const position = active === null ? -1 : choosable.indexOf(active);
    const next = position === -1 && step === -1 ? choosable.length - 1 : (position + step + choosable.length) % choosable.length;
    setActive(choosable[next]!);
    setOpen(null);
  }

  useEffect(() => {
    // A submenu that is a list handles the keys itself; custom panels leave them to this menu.
    if (openItem && !openItem.panel) return;
    const handle = (key: string): boolean => {
      switch (key) {
        case "ArrowDown":
        case "ArrowUp":
          move(key === "ArrowDown" ? 1 : -1);
          return true;
        case "ArrowRight":
          if (active !== null && hasSubmenu(entries[active] as MenuItem)) setOpen({ index: active, fromKeyboard: true });
          else if (onRight) onRight();
          else return false;
          return true;
        case "ArrowLeft":
          if (openItem) setOpen(null);
          else if (onLeft) onLeft();
          else return false;
          return true;
        case "Enter":
        case " ":
          if (active === null) return false;
          choose(active, true);
          return true;
        case "Escape":
          onClose();
          return true;
        case "Tab":
          onClose();
          return false;
        default:
          return false;
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!handle(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  });

  return (
    <ul
      ref={list}
      className={`menu-list${isSubmenu ? " submenu" : ""} ${className}`}
      role="menu"
      aria-label={label}
      style={at && { position: "fixed", left: at.x, top: at.y }}
      onMouseLeave={() => {
        if (!open) setActive(null);
      }}
    >
      {entries.map((entry, index) => {
        if (entry === "separator") return <li key={index} className="menu-separator" role="separator" />;
        if (!isItem(entry)) {
          return (
            <li key={index} className="menu-heading" role="presentation">
              {entry.heading}
            </li>
          );
        }
        const withSubmenu = hasSubmenu(entry);
        const submenuOpen = open?.index === index;
        return (
          <li
            key={index}
            role="none"
            className="menu-entry"
            onMouseEnter={() => {
              const disabled = isDisabled(entry);
              setActive(disabled ? null : index);
              setOpen(withSubmenu && !disabled ? { index, fromKeyboard: false } : null);
            }}
          >
            <button
              type="button"
              tabIndex={-1}
              role={entry.checked === undefined ? "menuitem" : "menuitemcheckbox"}
              aria-checked={entry.checked}
              aria-label={entry.label}
              aria-haspopup={withSubmenu ? "menu" : undefined}
              aria-expanded={withSubmenu ? submenuOpen : undefined}
              className={`menu-item${active === index ? " is-highlighted" : ""}`}
              disabled={isDisabled(entry)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(index, false)}
            >
              <span className="menu-item-icon">
                {entry.checked ? <Icon name="check" size={18} /> : entry.icon && <Icon name={entry.icon} size={18} />}
              </span>
              <span className="menu-item-label">{entry.content ?? entry.label}</span>
              {withSubmenu ? (
                <Icon name="arrow_right" size={18} className="menu-item-arrow" />
              ) : (
                entry.shortcut && <span className="menu-item-shortcut">{entry.shortcut}</span>
              )}
            </button>
            {submenuOpen &&
              (entry.panel ? (
                <MenuPanel label={entry.label}>{entry.panel(onClose)}</MenuPanel>
              ) : (
                <MenuList
                  entries={entry.submenu!}
                  isSubmenu
                  label={entry.label}
                  highlightFirst={open.fromKeyboard}
                  onClose={onClose}
                  onLeft={() => setOpen(null)}
                />
              ))}
          </li>
        );
      })}
    </ul>
  );
}

function MenuPanel({ label, children }: { label: string; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useFitInViewport(panel, true);
  return (
    <div ref={panel} className="menu-list submenu menu-panel" role="group" aria-label={label}>
      {children}
    </div>
  );
}

function isItem(entry: MenuEntry): entry is MenuItem {
  return entry !== "separator" && !("heading" in entry);
}

function hasSubmenu(entry: MenuItem): boolean {
  return entry.submenu !== undefined || entry.panel !== undefined;
}

function isDisabled(entry: MenuItem): boolean {
  return entry.disabled === true || (!entry.onSelect && !hasSubmenu(entry));
}

/**
 * Keeps a menu on screen: submenus open to the left instead, other menus shift. A menu opened at
 * a point opens to the left of it or above it where it would not fit.
 */
function useFitInViewport(ref: RefObject<HTMLElement | null>, isSubmenu: boolean, at?: { x: number; y: number }): void {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const margin = 8;
    const rect = element.getBoundingClientRect();
    if (at) {
      const flip = (start: number, size: number, limit: number) =>
        Math.max(margin, start + size > limit - margin ? Math.min(start - size, limit - margin - size) : start);
      element.style.left = `${flip(at.x, rect.width, innerWidth)}px`;
      element.style.top = `${flip(at.y, rect.height, innerHeight)}px`;
      return;
    }
    let x = 0;
    if (rect.right > innerWidth - margin) {
      if (isSubmenu) element.classList.add("submenu-start");
      else x = Math.max(innerWidth - margin - rect.right, margin - rect.left);
    }
    const y = rect.bottom > innerHeight - margin ? Math.max(innerHeight - margin - rect.bottom, margin - rect.top) : 0;
    if (x || y) element.style.translate = `${x}px ${y}px`;
  }, [ref, isSubmenu, at]);
}
