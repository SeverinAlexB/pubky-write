import type { ReactNode } from "react";

type ToolButtonProps = {
  /** Accessible name and tooltip, for example "Bold (⌘B)". */
  label: string;
  /** For toggles: shown pressed when on. Leave out for plain buttons. */
  active?: boolean;
  disabled?: boolean;
  className?: string;
  onClick?: () => void;
  onDoubleClick?: () => void;
  children: ReactNode;
};

export function ToolButton({ label, active, disabled, className = "", onClick, onDoubleClick, children }: ToolButtonProps) {
  return (
    <button
      type="button"
      className={`tool-button${active ? " is-active" : ""} ${className}`}
      aria-label={label}
      aria-pressed={active}
      data-tooltip={label}
      disabled={disabled ?? !onClick}
      // Keep the editor's selection and focus.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      {children}
    </button>
  );
}

export function Divider() {
  return <span className="toolbar-divider" aria-hidden />;
}
