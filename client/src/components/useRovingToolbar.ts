// Keyboard navigation for a toolbar, following the WAI-ARIA toolbar pattern: the toolbar is one
// Tab stop, ← → move between its controls (wrapping around), Home and End go to the first and
// last, and Escape leaves it. The controls are found in the DOM, so any component can be a
// toolbar item without knowing about this.
import { useEffect, type RefObject } from "react";

/** Popups inside the toolbar (menus, palettes), whose own controls are not toolbar items. */
const POPUP = '[role="menu"], [role="dialog"], [role="listbox"], .menu-panel, .toolbar-popover';
/** Marks controls whose tabindex this hook manages, as opposed to ones that are never tabbable. */
const MANAGED = "data-toolbar-item";

/** The toolbar's controls in DOM order: visible, enabled and not inside a popup. */
export function toolbarControls(toolbar: HTMLElement): HTMLElement[] {
  return Array.from(toolbar.querySelectorAll<HTMLElement>("button, input, select")).filter(
    (control) =>
      !control.closest(POPUP) &&
      !control.matches(":disabled") &&
      control.getAttribute("aria-hidden") !== "true" &&
      (control.tabIndex >= 0 || control.hasAttribute(MANAGED)) &&
      control.getClientRects().length > 0,
  );
}

/** Focuses the toolbar's current control (the one in the Tab order). */
export function focusToolbar(toolbar: HTMLElement | null): void {
  if (!toolbar) return;
  const controls = toolbarControls(toolbar);
  (controls.find((control) => control.tabIndex === 0) ?? controls[0])?.focus();
}

export function useRovingToolbar(ref: RefObject<HTMLElement | null>, onEscape: () => void): void {
  useEffect(() => {
    const toolbar = ref.current;
    if (!toolbar) return;
    // The control last focused in the toolbar.
    let current: HTMLElement | null = null;

    // Exactly one control is tabbable: the last one used, or else the first.
    const update = () => {
      const controls = toolbarControls(toolbar);
      const tabbable = current && controls.includes(current) ? current : controls[0];
      for (const control of controls) {
        control.setAttribute(MANAGED, "");
        const tabIndex = control === tabbable ? "0" : "-1";
        if (control.getAttribute("tabindex") !== tabIndex) control.setAttribute("tabindex", tabIndex);
      }
    };

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest(POPUP) || !toolbarControls(toolbar).includes(target)) return;
      current = target;
      update();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey || target.closest(POPUP)) return;
      const controls = toolbarControls(toolbar);
      const index = controls.indexOf(target);
      if (index < 0) return;
      // While one of the toolbar's menus is open, the keys belong to it.
      if (toolbar.querySelector('[aria-expanded="true"]')) return;

      if (event.key === "Escape") {
        event.preventDefault();
        onEscape();
        return;
      }
      let next: number | null = null;
      const text = target instanceof HTMLInputElement ? target : null;
      // In a text field ← and → move the caret, and only leave it from its start or end.
      const atStart = !text || (text.selectionStart === 0 && text.selectionEnd === 0);
      const atEnd = !text || (text.selectionStart === text.value.length && text.selectionEnd === text.value.length);
      if (event.key === "ArrowRight" && atEnd) next = (index + 1) % controls.length;
      else if (event.key === "ArrowLeft" && atStart) next = (index - 1 + controls.length) % controls.length;
      else if (event.key === "Home" && !text) next = 0;
      else if (event.key === "End" && !text) next = controls.length - 1;
      if (next === null) return;
      event.preventDefault();
      current = controls[next]!;
      update();
      current.focus();
    };

    // Controls come and go (overflow into "More", disabled states), so keep the tabindexes current.
    const observer = new MutationObserver(update);
    observer.observe(toolbar, { subtree: true, childList: true, attributes: true, attributeFilter: ["disabled"] });
    update();
    toolbar.addEventListener("focusin", onFocusIn);
    toolbar.addEventListener("keydown", onKeyDown);
    return () => {
      observer.disconnect();
      toolbar.removeEventListener("focusin", onFocusIn);
      toolbar.removeEventListener("keydown", onKeyDown);
    };
  }, [ref, onEscape]);
}
