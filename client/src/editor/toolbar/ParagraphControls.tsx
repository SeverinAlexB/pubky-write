import type { Editor } from "@tiptap/react";
import { Icon, type IconName } from "../../components/Icon.tsx";
import { Menu } from "../../components/Menu.tsx";
import { usePopover } from "../../components/usePopover.ts";
import { withShortcut } from "../../components/shortcuts.ts";
import type { EditorActions, ListKind } from "../actions.ts";
import { lineSpacingEntries, type ParagraphSpacingState } from "../formatMenus.ts";
import { ListPresetGrid } from "../ListPresets.tsx";
import { ToolButton } from "./ToolButton.tsx";

export type Alignment = "left" | "center" | "right" | "justify";

export const alignments: { value: Alignment; label: string; shortcut: string; icon: IconName }[] = [
  { value: "left", label: "Left align", shortcut: "⌘+Shift+L", icon: "format_align_left" },
  { value: "center", label: "Centre align", shortcut: "⌘+Shift+E", icon: "format_align_center" },
  { value: "right", label: "Right align", shortcut: "⌘+Shift+R", icon: "format_align_right" },
  { value: "justify", label: "Justify", shortcut: "⌘+Shift+J", icon: "format_align_justify" },
];

/** Shows the current alignment; opens a row of the four alignment buttons. */
export function AlignControl({ editor, current }: { editor: Editor; current: Alignment }) {
  const { open, setOpen, close, root } = usePopover();
  const icon = alignments.find((alignment) => alignment.value === current)!.icon;

  return (
    <div className="menu" ref={root}>
      <button
        type="button"
        className="tool-button tool-button-with-arrow align-button"
        aria-label="Align and indent"
        data-tooltip="Align and indent"
        aria-haspopup="true"
        aria-expanded={open}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name={icon} size={20} />
        <Icon name="arrow_drop_down" size={16} className="tool-button-arrow" />
      </button>
      {open && (
        <div className="toolbar-popover align-popover" role="group" aria-label="Align and indent">
          {alignments.map((alignment) => (
            <ToolButton
              key={alignment.value}
              label={withShortcut(alignment.label, alignment.shortcut)}
              active={alignment.value === current}
              onClick={() => {
                close();
                editor.chain().focus().setTextAlign(alignment.value).run();
              }}
            >
              <Icon name={alignment.icon} size={20} />
            </ToolButton>
          ))}
        </div>
      )}
    </div>
  );
}

export function LineSpacingControl({
  editor,
  actions,
  current,
}: {
  editor: Editor;
  actions: EditorActions;
  current: ParagraphSpacingState;
}) {
  return (
    <Menu
      label={<Icon name="format_line_spacing" size={20} />}
      ariaLabel="Line & paragraph spacing"
      buttonClassName="tool-button"
      listClassName="line-spacing-menu"
      entries={lineSpacingEntries(editor, actions, current)}
    />
  );
}

type ListControlProps = {
  kind: ListKind;
  label: string;
  icon: IconName;
  active: boolean;
  onToggle?: () => void;
  onPickPreset?: (kind: ListKind, preset: number) => void;
};

/** A list toggle with a narrow ▾ beside it that opens the list's presets. */
export function ListControl({ kind, label, icon, active, onToggle, onPickPreset }: ListControlProps) {
  const { open, setOpen, close, root } = usePopover();
  const name = label.replace(/ \(.*\)$/, "");

  return (
    <div className="menu list-control" ref={root}>
      <ToolButton label={label} active={active} onClick={onToggle}>
        <Icon name={icon} size={20} />
      </ToolButton>
      <button
        type="button"
        className="tool-button list-menu-button"
        aria-label={`${name} menu`}
        data-tooltip={`${name} menu`}
        aria-haspopup="true"
        aria-expanded={open}
        disabled={!onPickPreset}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="arrow_drop_down" size={16} />
      </button>
      {open && onPickPreset && (
        <div className="toolbar-popover">
          <ListPresetGrid
            kind={kind}
            onPick={(preset) => {
              close();
              onPickPreset(kind, preset);
            }}
          />
        </div>
      )}
    </div>
  );
}
