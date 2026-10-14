// Insert > Page elements > Page numbers > More options, and Options > Page numbers… in a header.
import { MAX_PAGE_NUMBER_START } from "@docs/shared";
import { useEffect, useRef, useState } from "react";
import type { PageNumberOptions } from "./pageElementCommands.ts";

type PageNumbersDialogProps = {
  initial: Required<PageNumberOptions>;
  onApply: (options: Required<PageNumberOptions>) => void;
  onCancel: () => void;
};

export function PageNumbersDialog({ initial, onApply, onCancel }: PageNumbersDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [position, setPosition] = useState(initial.position);
  const [showOnFirstPage, setShowOnFirstPage] = useState(initial.showOnFirstPage);
  const [start, setStart] = useState(String(initial.start));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => dialog.current?.showModal(), []);

  const apply = () => {
    const value = Number(start);
    if (start.trim() === "" || !Number.isInteger(value) || value < 0 || value > MAX_PAGE_NUMBER_START) {
      return setError(`Enter a whole number from 0 to ${MAX_PAGE_NUMBER_START}.`);
    }
    onApply({ position, showOnFirstPage, start: value });
  };

  return (
    <dialog ref={dialog} className="dialog page-numbers-dialog" aria-labelledby="page-numbers-title" onCancel={onCancel} onClose={onCancel}>
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          apply();
        }}
      >
        <h2 id="page-numbers-title">Page numbers</h2>
        <fieldset>
          <legend>Position</legend>
          {(["header", "footer"] as const).map((value) => (
            <label key={value} className="radio-option">
              <input type="radio" name="position" checked={position === value} onChange={() => setPosition(value)} />
              {value === "header" ? "Header" : "Footer"}
            </label>
          ))}
          <label className="radio-option">
            <input type="checkbox" checked={showOnFirstPage} onChange={(event) => setShowOnFirstPage(event.target.checked)} />
            Show on first page
          </label>
        </fieldset>
        <fieldset>
          <legend>Numbering</legend>
          <label className="radio-option">
            <input type="radio" name="numbering" disabled />
            Continue from previous section
          </label>
          <label className="radio-option">
            <input type="radio" name="numbering" checked readOnly />
            Start at
            <input
              type="number"
             
              aria-label="Start at"
              min={0}
              max={MAX_PAGE_NUMBER_START}
              value={start}
              onChange={(event) => {
                setStart(event.target.value);
                setError(null);
              }}
            />
          </label>
        </fieldset>
        {error && (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        )}
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
