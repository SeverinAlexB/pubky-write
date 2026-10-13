import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "../../components/Icon.tsx";
import { usePopover } from "../../components/usePopover.ts";

/** The standard palette: 8 rows of 10 colours. */
export const paletteRows = [
  ["#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#cccccc", "#d9d9d9", "#efefef", "#f3f3f3", "#ffffff"],
  ["#980000", "#ff0000", "#ff9900", "#ffff00", "#00ff00", "#00ffff", "#4a86e8", "#0000ff", "#9900ff", "#ff00ff"],
  ["#e6b8af", "#f4cccc", "#fce5cd", "#fff2cc", "#d9ead3", "#d0e0e3", "#c9daf8", "#cfe2f3", "#d9d2e9", "#ead1dc"],
  ["#dd7e6b", "#ea9999", "#f9cb9c", "#ffe599", "#b6d7a8", "#a2c4c9", "#a4c2f4", "#9fc5e8", "#b4a7d6", "#d5a6bd"],
  ["#cc4125", "#e06666", "#f6b26b", "#ffd966", "#93c47d", "#76a5af", "#6d9eeb", "#6fa8dc", "#8e7cc3", "#c27ba0"],
  ["#a61c00", "#cc0000", "#e69138", "#f1c232", "#6aa84f", "#45818e", "#3c78d8", "#3d85c6", "#674ea7", "#a64d79"],
  ["#85200c", "#990000", "#b45f06", "#bf9000", "#38761d", "#134f5c", "#1155cc", "#0b5394", "#351c75", "#741b47"],
  ["#5b0f00", "#660000", "#783f04", "#7f6000", "#274e13", "#0c343d", "#1c4587", "#073763", "#20124d", "#4c1130"],
];

/** Swatches so light they need a border to show on white. */
const lightColors = new Set(["#d9d9d9", "#efefef", "#f3f3f3", "#ffffff"]);

const CUSTOM_COLORS_SETTING = "docs.customColors";
const MAX_CUSTOM_COLORS = 10;

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
  const [customColors, setCustomColors] = useState(loadCustomColors);
  const nativePicker = useRef<HTMLInputElement>(null);
  const selected = current?.toLowerCase() ?? null;

  const pick = (color: string | null) => {
    close();
    onPick(color);
  };

  // The native picker's "change" fires once, when the user confirms a colour.
  useEffect(() => {
    const input = nativePicker.current;
    if (!input) return;
    const onChange = () => {
      const color = input.value.toLowerCase();
      const colors = [color, ...customColors.filter((custom) => custom !== color)].slice(0, MAX_CUSTOM_COLORS);
      setCustomColors(colors);
      localStorage.setItem(CUSTOM_COLORS_SETTING, JSON.stringify(colors));
      pick(color);
    };
    input.addEventListener("change", onChange);
    return () => input.removeEventListener("change", onChange);
  });

  const swatch = (color: string) => (
    <button
      key={color}
      type="button"
      className={`color-swatch${lightColors.has(color) ? " is-light" : ""}`}
      style={{ background: color }}
      aria-label={color}
      aria-pressed={color === selected}
      data-tooltip={color}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => pick(color)}
    >
      {color === selected && <Icon name="check" size={14} className={isDark(color) ? "check-light" : undefined} />}
    </button>
  );

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
        <div className="color-popover" role="dialog" aria-label={label}>
          {allowNone && (
            <button
              type="button"
              className="color-none"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(null)}
            >
              <Icon name="format_color_reset" size={18} />
              None
            </button>
          )}
          <div className="color-grid" role="group" aria-label="Standard colours">
            {paletteRows.flat().map(swatch)}
          </div>
          <div className="color-custom-label">CUSTOM</div>
          <div className="color-grid" role="group" aria-label="Custom colours">
            <button
              type="button"
              className="color-add"
              aria-label="Add a custom colour"
              data-tooltip="Add a custom colour"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => nativePicker.current?.click()}
            >
              <Icon name="add" size={18} />
            </button>
            {customColors.map(swatch)}
          </div>
          <input ref={nativePicker} type="color" className="visually-hidden" tabIndex={-1} aria-hidden />
        </div>
      )}
    </div>
  );
}

function loadCustomColors(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(CUSTOM_COLORS_SETTING) ?? "[]");
    return Array.isArray(stored) ? stored.filter((color) => typeof color === "string") : [];
  } catch {
    return [];
  }
}

/** Whether a check mark on this colour needs to be white to show. */
function isDark(color: string): boolean {
  const value = Number.parseInt(color.slice(1), 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b < 150;
}
