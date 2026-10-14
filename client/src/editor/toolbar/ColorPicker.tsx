import type { ReactNode } from "react";
import { lazyComponent } from "../../components/lazyComponent.tsx";
import { usePopover } from "../../components/usePopover.ts";

/** The palette popover is in its own chunk, loaded when the editor is idle or first opened. */
export const ColorPalette = lazyComponent(() => import("./ColorPalette.tsx").then((module) => module.ColorPalette));

type ColorPickerProps = {
  label: string;
  icon: ReactNode;
  /** The colour at the cursor, shown in the bar under the icon and checked in the palette. */
  current: string | null;
  /** Shows a "None" entry first (highlight colour). */
  allowNone?: boolean;
  onPick: (color: string | null) => void;
};

/** A toolbar button with a colour bar under its icon that opens the colour palette. */
export function ColorPicker({ label, icon, current, allowNone = false, onPick }: ColorPickerProps) {
  const { open, setOpen, close, root } = usePopover();

  const pick = (color: string | null) => {
    close();
    onPick(color);
  };

  return (
    <div className="menu" ref={root}>
      <button
        type="button"
        className="tool-button color-button"
        aria-label={label}
        data-tooltip={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
      >
        {icon}
      </button>
      {open && (
        <ColorPalette label={label} selected={current?.toLowerCase() ?? null} allowNone={allowNone} onPick={pick} />
      )}
    </div>
  );
}
