// Format > Table > Split cell (or the right-click menu): into how many columns and rows.
import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "../components/Icon.tsx";
import { MAX_SPLIT } from "./tableExtras.ts";

type SplitCellDialogProps = {
  onSplit: (columns: number, rows: number) => void;
  onCancel: () => void;
};

export function SplitCellDialog({ onSplit, onCancel }: SplitCellDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [columns, setColumns] = useState("1");
  const [rows, setRows] = useState("1");
  useEffect(() => dialog.current?.showModal(), []);

  const read = (value: string) => {
    const number = Number(value);
    return Number.isInteger(number) && number >= 1 ? Math.min(number, MAX_SPLIT) : 1;
  };

  return (
    <dialog ref={dialog} className="dialog split-cell-dialog" aria-labelledby="split-cell-title" onCancel={onCancel} onClose={onCancel}>
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          onSplit(read(columns), read(rows));
        }}
      >
        <h2 id="split-cell-title">Split cell</h2>
        <div className="split-cell-fields">
          <SplitField label="Columns" icon="view_column" value={columns} onChange={setColumns} autoFocus />
          <SplitField label="Rows" icon="table_rows" value={rows} onChange={setRows} />
        </div>
        <div className="dialog-actions">
          <button type="button" className="button-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="button-primary">
            Split
          </button>
        </div>
      </form>
    </dialog>
  );
}

function SplitField({
  label,
  icon,
  value,
  onChange,
  autoFocus,
}: {
  label: string;
  icon: IconName;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <label className="split-cell-field">
      <Icon name={icon} />
      <span className="text-field">
        <input
          type="number"
          min={1}
          max={MAX_SPLIT}
          step={1}
          value={value}
          placeholder=" "
          aria-label={label}
          autoFocus={autoFocus}
          onChange={(event) => onChange(event.target.value)}
          onFocus={(event) => event.target.select()}
        />
        <span className="text-field-label" aria-hidden>
          {label}
        </span>
      </span>
    </label>
  );
}
