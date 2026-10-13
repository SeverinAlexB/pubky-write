import type { ListKind } from "./actions.ts";

/** The glyphs of the first three levels of each list preset, in menu order. */
export const listPresets: Record<ListKind, { label: string; glyphs: string[] }[]> = {
  bullet: [
    { label: "Disc, circle, square", glyphs: ["●", "○", "■"] },
    { label: "Diamond, arrowhead, square", glyphs: ["❖", "➢", "■"] },
    { label: "Arrow, diamond, disc", glyphs: ["→", "◆", "●"] },
    { label: "Star, circle, square", glyphs: ["★", "○", "■"] },
  ],
  numbered: [
    { label: "1. a. i.", glyphs: ["1.", "a.", "i."] },
    { label: "A. a. i.", glyphs: ["A.", "a.", "i."] },
    { label: "1) a) i)", glyphs: ["1)", "a)", "i)"] },
    { label: "1. 1.1. 1.1.1.", glyphs: ["1.", "1.1.", "1.1.1."] },
  ],
  checklist: [
    { label: "Checklist", glyphs: ["☐", "☐", "☐"] },
    { label: "Checklist with strike-through", glyphs: ["☑", "☑", "☐"] },
  ],
};

/** The preset grid of the list menus in the toolbar and in Format > Bullets and numbering. */
export function ListPresetGrid({ kind, onPick }: { kind: ListKind; onPick: (preset: number) => void }) {
  return (
    <div className={`list-presets list-presets-${kind}`} role="group" aria-label={`${kind} presets`}>
      {listPresets[kind].map((preset, index) => (
        <button
          key={preset.label}
          type="button"
          className="list-preset"
          aria-label={preset.label}
          data-tooltip={preset.label}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(index)}
        >
          {preset.glyphs.map((glyph, level) => (
            <span
              key={level}
              className={`list-preset-line${kind === "checklist" && index === 1 && level < 2 ? " is-struck" : ""}`}
              style={{ paddingLeft: level * 10 }}
            >
              <span className="list-preset-glyph">{glyph}</span>
              <span className="list-preset-text" />
            </span>
          ))}
        </button>
      ))}
    </div>
  );
}
