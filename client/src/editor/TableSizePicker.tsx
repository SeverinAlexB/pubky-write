import { useState } from "react";

const MAX_SIZE = 20;
const MIN_SHOWN = 10;

/** Insert > Table: hover over the grid to choose columns × rows, click to insert. */
export function TableSizePicker({ onPick }: { onPick: (columns: number, rows: number) => void }) {
  const [size, setSize] = useState({ columns: 1, rows: 1 });
  // The grid grows one step beyond the hovered cell, up to 20 × 20.
  const shownColumns = Math.min(Math.max(MIN_SHOWN, size.columns + 1), MAX_SIZE);
  const shownRows = Math.min(Math.max(MIN_SHOWN, size.rows + 1), MAX_SIZE);

  return (
    <div className="table-picker">
      <div
        className="table-picker-grid"
        style={{ gridTemplateColumns: `repeat(${shownColumns}, 18px)` }}
        onMouseDown={(event) => event.preventDefault()}
      >
        {Array.from({ length: shownRows }, (_, row) =>
          Array.from({ length: shownColumns }, (_, column) => (
            <button
              key={`${row}-${column}`}
              type="button"
              tabIndex={-1}
              className={`table-picker-cell${column < size.columns && row < size.rows ? " is-selected" : ""}`}
              aria-label={`${column + 1} x ${row + 1}`}
              onMouseEnter={() => setSize({ columns: column + 1, rows: row + 1 })}
              onClick={() => onPick(column + 1, row + 1)}
            />
          )),
        )}
      </div>
      <div className="table-picker-label" aria-live="polite">
        {size.columns} x {size.rows}
      </div>
    </div>
  );
}
