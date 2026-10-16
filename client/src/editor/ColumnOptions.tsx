// Format > Columns: three presets (one, two and three columns) and the Column options dialog.
import { columnSpacingCm, MAX_COLUMN_SPACING_PT, MAX_COLUMNS, PT_PER_CM, type ColumnSettings } from "@pubky-write/shared";
import { useEffect, useRef, useState } from "react";

const presets = [1, 2, 3] as const;

type ColumnPresetsProps = {
  current: number;
  onPick: (columns: number) => void;
  onMoreOptions: () => void;
};

/** The submenu of Format > Columns: the current number of columns is outlined. */
export function ColumnPresetsPanel({ current, onPick, onMoreOptions }: ColumnPresetsProps) {
  return (
    <div onMouseDown={(event) => event.preventDefault()}>
      <div className="preset-grid is-columns">
        {presets.map((count) => {
          const label = count === 1 ? "One column" : count === 2 ? "Two columns" : "Three columns";
          return (
            <button
              key={count}
              type="button"
              role="menuitemradio"
              aria-checked={current === count}
              tabIndex={-1}
              className={`preset-tile column-preset${current === count ? " is-current" : ""}`}
              aria-label={label}
              data-tooltip={label}
              onClick={() => onPick(count)}
            >
              <ColumnsIcon count={count} />
            </button>
          );
        })}
      </div>
      <div className="preset-panel-items">
        <button type="button" role="menuitem" tabIndex={-1} className="menu-item" onClick={onMoreOptions}>
          <span className="menu-item-icon" />
          <span className="menu-item-label">More options</span>
        </button>
      </div>
    </div>
  );
}

/** A page with `count` columns of text lines. */
function ColumnsIcon({ count }: { count: number }) {
  const gap = 4;
  const width = (40 - gap * (count - 1)) / count;
  return (
    <svg viewBox="0 0 56 76" aria-hidden>
      <rect x="0.5" y="0.5" width="55" height="75" rx="2" fill="#fff" stroke="#80868b" />
      {Array.from({ length: count }, (_, column) =>
        [10, 16, 22, 28, 34, 40, 46, 52, 58].map((y) => (
          <rect key={`${column}-${y}`} x={8 + column * (width + gap)} y={y} width={y === 58 ? width * 0.6 : width} height="2" fill="#5f6368" />
        )),
      )}
    </svg>
  );
}

type ColumnOptionsDialogProps = {
  initial: ColumnSettings;
  onApply: (settings: ColumnSettings) => void;
  onCancel: () => void;
};

/** Format > Columns > More options: number of columns, spacing in centimetres and a line between them. */
export function ColumnOptionsDialog({ initial, onApply, onCancel }: ColumnOptionsDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [columns, setColumns] = useState(initial.columns);
  const [spacing, setSpacing] = useState(String(columnSpacingCm(initial.columnSpacing)));
  const [line, setLine] = useState(initial.columnLine);
  useEffect(() => dialog.current?.showModal(), []);

  const apply = () => {
    const centimetres = Number(spacing);
    // An empty or invalid spacing keeps the current one.
    const columnSpacing =
      spacing.trim() !== "" && Number.isFinite(centimetres) && centimetres >= 0
        ? Math.min(Math.round(centimetres * PT_PER_CM * 100) / 100, MAX_COLUMN_SPACING_PT)
        : initial.columnSpacing;
    onApply({ columns, columnSpacing, columnLine: line });
  };

  return (
    <dialog ref={dialog} className="dialog column-options-dialog" aria-labelledby="column-options-title" onCancel={onCancel} onClose={onCancel}>
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          apply();
        }}
      >
        <h2 id="column-options-title">Column options</h2>
        <div className="column-options-fields">
          <label className="column-options-field">
            <span>Number of columns</span>
            <select className="select-field" aria-label="Number of columns" value={columns} onChange={(event) => setColumns(Number(event.target.value))} autoFocus>
              {Array.from({ length: MAX_COLUMNS }, (_, index) => index + 1).map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </label>
          <label className="column-options-field">
            <span>Spacing (centimetres)</span>
            <input
              className="select-field"
              type="number"
              min={0}
              step={0.01}
              aria-label="Spacing (centimetres)"
              value={spacing}
              disabled={columns === 1}
              onChange={(event) => setSpacing(event.target.value)}
            />
          </label>
          <label className="column-options-field">
            <span>Line between columns</span>
            <span className="column-options-check">
              <input type="checkbox" checked={line} disabled={columns === 1} onChange={(event) => setLine(event.target.checked)} />
            </span>
          </label>
        </div>
        <div className="dialog-actions">
          <button type="button" className="button-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="button-primary">
            Apply
          </button>
        </div>
      </form>
    </dialog>
  );
}
