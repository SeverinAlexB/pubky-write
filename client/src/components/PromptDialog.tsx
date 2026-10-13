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

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog ref={dialog} className="dialog" onCancel={onCancel} onClose={onCancel}>
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm(value);
        }}
      >
        <h2>{title}</h2>
        <label>
          <span className="visually-hidden">{label}</span>
          <input
            autoFocus
            value={value}
            placeholder={placeholder}
            aria-label={label}
            onChange={(event) => setValue(event.target.value)}
            onFocus={(event) => event.target.select()}
          />
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
