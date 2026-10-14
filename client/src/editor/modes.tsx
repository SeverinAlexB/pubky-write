// Editing, Suggesting and Viewing: the mode button's menu (also View > Mode) and the stored mode.
import { Icon, type IconName } from "../components/Icon.tsx";
import { Menu } from "../components/Menu.tsx";
import type { MenuEntry } from "../components/MenuList.tsx";
import type { EditorMode } from "./suggesting.ts";

export const editorModes: { mode: EditorMode; title: string; description: string; icon: IconName }[] = [
  { mode: "editing", title: "Editing", description: "Edit document directly", icon: "edit" },
  { mode: "suggesting", title: "Suggesting", description: "Edits become suggestions", icon: "edit_square" },
  { mode: "viewing", title: "Viewing", description: "Read or print final document", icon: "visibility" },
];

/** The three modes as menu items: icon, title and description, with a check mark on the current one. */
export function modeEntries(current: EditorMode, onSelect: (mode: EditorMode) => void): MenuEntry[] {
  return editorModes.map(({ mode, title, description, icon }) => ({
    label: title,
    content: (
      <span className="mode-item">
        <Icon name={icon} />
        <span className="mode-item-text">
          <span className="mode-item-title">{title}</span>
          <span className="mode-item-description">{description}</span>
        </span>
      </span>
    ),
    checked: current === mode,
    onSelect: () => onSelect(mode),
  }));
}

/** The mode button at the right end of the toolbar. */
export function ModeButton({ mode, onChange }: { mode: EditorMode; onChange: (mode: EditorMode) => void }) {
  const current = editorModes.find((candidate) => candidate.mode === mode)!;
  return (
    <Menu
      label={
        <>
          <Icon name={current.icon} />
          <Icon name="arrow_drop_down" size={16} className="tool-button-arrow" />
        </>
      }
      ariaLabel={`${current.title} mode`}
      buttonClassName={`tool-button tool-button-with-arrow mode-button${mode === "suggesting" ? " is-suggesting" : ""}`}
      align="end"
      listClassName="mode-menu"
      entries={modeEntries(mode, onChange)}
    />
  );
}

const modeSetting = (documentId: string) => `docs.mode.${documentId}`;

/** The mode last used for a document in this browser. */
export function storedMode(documentId: string): EditorMode {
  const stored = localStorage.getItem(modeSetting(documentId));
  return stored === "suggesting" || stored === "viewing" ? stored : "editing";
}

export function storeMode(documentId: string, mode: EditorMode): void {
  if (mode === "editing") localStorage.removeItem(modeSetting(documentId));
  else localStorage.setItem(modeSetting(documentId), mode);
}
