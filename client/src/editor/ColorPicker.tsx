import { useCallback, useRef, useState, type ReactNode } from "react";
import { useDismiss } from "../components/useDismiss.ts";

export const textColors = [
  "#000000", "#434343", "#666666", "#999999", "#b7b7b7",
  "#980000", "#ff0000", "#ff9900", "#ffff00", "#00ff00",
  "#00ffff", "#4a86e8", "#0000ff", "#9900ff", "#ff00ff",
  "#e6b8af", "#f4cccc", "#fce5cd", "#fff2cc", "#d9ead3",
];

type ColorPickerProps = {
  label: string;
  icon: ReactNode;
  current: string | undefined;
  resetLabel: string;
  onPick: (color: string | null) => void;
};

/** A toolbar button with a swatch underline that opens a colour grid. */
export function ColorPicker({ label, icon, current, resetLabel, onPick }: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(root, open, useCallback(() => setOpen(false), []));

  const pick = (color: string | null) => {
    setOpen(false);
    onPick(color);
  };

  return (
    <div className="menu" ref={root}>
      <button
        type="button"
        className="tool-button color-button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
      >
        {icon}
        <span className="color-swatch-bar" style={{ background: current ?? "transparent" }} />
      </button>
      {open && (
        <div className="color-popover" role="dialog" aria-label={label}>
          <button type="button" className="color-reset" onMouseDown={(event) => event.preventDefault()} onClick={() => pick(null)}>
            {resetLabel}
          </button>
          <div className="color-grid">
            {textColors.map((color) => (
              <button
                key={color}
                type="button"
                className="color-swatch"
                style={{ background: color }}
                aria-label={color}
                title={color}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(color)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
