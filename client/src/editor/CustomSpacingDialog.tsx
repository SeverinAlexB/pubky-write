import type { ParagraphSpacing } from "@pubky-write/shared";
import { useEffect, useRef, useState } from "react";
import type { ParagraphSpacingState } from "./formatMenus.ts";

const MAX_LINE_SPACING = 100;

type CustomSpacingDialogProps = {
  /** The spacing of the paragraph at the cursor, shown as the starting values. */
  initial: ParagraphSpacingState;
  onApply: (spacing: ParagraphSpacing) => void;
  onCancel: () => void;
};

/** Format > Line & paragraph spacing > Custom spacing. */
export function CustomSpacingDialog({ initial, onApply, onCancel }: CustomSpacingDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [lineSpacing, setLineSpacing] = useState(String(initial.lineSpacing));
  const [before, setBefore] = useState(String(initial.spaceBefore));
  const [after, setAfter] = useState(String(initial.spaceAfter));
  useEffect(() => dialog.current?.showModal(), []);

  const apply = () => {
    // Fields left empty or with invalid values keep the current spacing.
    const read = (value: string, max: number) => {
      const number = Number(value);
      return value.trim() !== "" && Number.isFinite(number) && number >= 0 ? Math.min(number, max) : undefined;
    };
    const line = read(lineSpacing, MAX_LINE_SPACING);
    onApply({
      lineSpacing: line && line > 0 ? line : undefined,
      spaceBefore: read(before, 1000),
      spaceAfter: read(after, 1000),
    });
  };

  return (
    <dialog
      ref={dialog}
      className="dialog custom-spacing-dialog"
      aria-labelledby="custom-spacing-title"
      onCancel={onCancel}
      onClose={onCancel}
    >
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          apply();
        }}
      >
        <h2 id="custom-spacing-title">Custom spacing</h2>
        <NumberField label="Line spacing" value={lineSpacing} onChange={setLineSpacing} step="0.01" autoFocus />
        <fieldset className="spacing-fields">
          <legend>Paragraph spacing (pts)</legend>
          <NumberField label="Before" value={before} onChange={setBefore} step="1" />
          <NumberField label="After" value={after} onChange={setAfter} step="1" />
        </fieldset>
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

function NumberField({
  label,
  value,
  onChange,
  step,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  step: string;
  autoFocus?: boolean;
}) {
  return (
    <label className="text-field">
      <input
        type="number"
        min={0}
        step={step}
        autoFocus={autoFocus}
        value={value}
        placeholder=" "
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
        onFocus={(event) => event.target.select()}
      />
      <span className="text-field-label" aria-hidden>
        {label}
      </span>
    </label>
  );
}
