import { useEffect, useRef, useState } from "react";

type PromptDialogProps = {
  title: string;
  label: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
};

/** A modal with one text field, used for renaming documents and editing links. */
export function PromptDialog({
  title,
  label,
  initialValue = "",
  placeholder,
  confirmLabel = "OK",
  onConfirm,
  onCancel,
}: PromptDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(initialValue);
  const confirmed = useRef(false);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog ref={dialog} className="dialog" onCancel={onCancel} onClose={() => confirmed.current || onCancel()}>
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          // Closed now rather than when it is removed: until then the modal dialog makes the page
          // inert, and keys typed right after confirming would be lost.
          confirmed.current = true;
          dialog.current?.close();
          onConfirm(value);
        }}
      >
        <h2>{title}</h2>
        <label className="text-field">
          <input
            autoFocus
            value={value}
            // The label stands in for the placeholder until the field is focused.
            placeholder={placeholder ?? " "}
            aria-label={label}
            onChange={(event) => setValue(event.target.value)}
            onFocus={(event) => event.target.select()}
          />
          <span className="text-field-label" aria-hidden>
            {label}
          </span>
        </label>
        <div className="dialog-actions">
          <button type="button" className="button-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="button-primary">
            {confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
