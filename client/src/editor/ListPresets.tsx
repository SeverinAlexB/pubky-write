import { bulletPresets, checklistPresets, listNumberLabel, numberedPresets } from "@pubky-write/shared";
import { useState } from "react";
import { Icon } from "../components/Icon.tsx";
import type { ListKind } from "./actions.ts";

/** The list level of each preview line: level 1, level 2, level 2, level 3, level 1. */
const previewLevels = [0, 1, 1, 2, 0];
/** The item numbers of each preview line, outermost level first. */
const previewPaths = [[1], [1, 1], [1, 2], [1, 2, 1], [2]];

type PresetTile = { label: string; markers: string[]; struck?: boolean[] };

/** The presets of each list kind in menu order, with the markers of their five preview lines. */
export const listPresets: Record<ListKind, PresetTile[]> = {
  bullet: bulletPresets.map(({ label, glyphs }) => ({
    label,
    markers: previewLevels.map((level) => glyphs[level % glyphs.length]!),
  })),
  numbered: numberedPresets.map((preset) => ({
    label: preset.label,
    markers: previewPaths.map((path) => listNumberLabel(preset, path)),
  })),
  checklist: checklistPresets.map(({ label }, index) => {
    // The strike-through preview shows its first two items checked and struck through.
    const checked = previewLevels.map((_, line) => index === 1 && line < 2);
    return { label, markers: checked.map((on) => (on ? "☑" : "☐")), struck: checked };
  }),
};

type ListPresetGridProps = {
  kind: ListKind;
  /** The preset of the list at the cursor, shown with a primary-colour border. */
  current: number | null;
  onPick: (preset: number) => void;
};

/** A grid of preset tiles, each previewing five list lines. */
export function ListPresetGrid({ kind, current, onPick }: ListPresetGridProps) {
  return (
    <div className={`list-presets list-presets-${kind}`} role="group" aria-label={`${kind} presets`}>
      {listPresets[kind].map((preset, index) => (
        <button
          key={preset.label}
          type="button"
          className={`list-preset${index === current ? " is-current" : ""}`}
          aria-label={preset.label}
          aria-pressed={index === current}
          data-tooltip={preset.label}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(index)}
        >
          {preset.markers.map((marker, line) => (
            <span
              key={line}
              className={`list-preset-line${preset.struck?.[line] ? " is-struck" : ""}`}
              style={{ paddingLeft: previewLevels[line]! * 8 }}
            >
              <span className="list-preset-glyph">{marker}</span>
              <span className="list-preset-text" />
            </span>
          ))}
        </button>
      ))}
    </div>
  );
}

type ListPresetMenuProps = {
  kind: ListKind;
  /** The preset of each kind of list at the cursor, or null outside such a list. */
  current: Record<ListKind, number | null>;
  onPick: (kind: ListKind, preset: number) => void;
};

/**
 * The content of a list menu (toolbar ▾ or Format > Bullets and numbering): the preset grid; the
 * bulleted list menu also ends with "Checklist menu ▸", which opens the checklist presets.
 */
export function ListPresetMenu({ kind, current, onPick }: ListPresetMenuProps) {
  return (
    <div className="list-preset-menu">
      <ListPresetGrid kind={kind} current={current[kind]} onPick={(preset) => onPick(kind, preset)} />
      {kind === "bullet" && (
        <>
          <div className="menu-separator" role="separator" />
          <ChecklistSubmenu current={current.checklist} onPick={(preset) => onPick("checklist", preset)} />
        </>
      )}
    </div>
  );
}

function ChecklistSubmenu({ current, onPick }: { current: number | null; onPick: (preset: number) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="menu-entry" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        role="menuitem"
        className="menu-item"
        aria-label="Checklist menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="menu-item-icon">
          <Icon name="checklist" size={18} />
        </span>
        <span className="menu-item-label">Checklist menu</span>
        <Icon name="arrow_right" size={18} className="menu-item-arrow" />
      </button>
      {open && (
        <div className="menu-list submenu menu-panel" role="group" aria-label="Checklist menu">
          <ListPresetGrid kind="checklist" current={current} onPick={onPick} />
        </div>
      )}
    </div>
  );
}
