import { useEffect, useRef } from "react";

type ConfirmDialogProps = {
  title: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/** A modal question with Cancel and one main action. */
export function ConfirmDialog({ title, confirmLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog ref={dialog} className="dialog" aria-labelledby="confirm-dialog-title" onCancel={onCancel}>
      <h2 id="confirm-dialog-title">{title}</h2>
      <div className="dialog-actions">
        <button type="button" className="button-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="button-primary" autoFocus onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
