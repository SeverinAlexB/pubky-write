import {
  pageSizeMm,
  paperSizes,
  pointsPerUnit,
  PX_PER_MM,
  PX_PER_PT,
  type LengthUnit,
  type PageOrientation,
  type PageSetup,
  type PaperSize,
} from "@docs/shared";
import { useEffect, useRef, useState } from "react";

/** The writable area must stay at least this large, in points (one inch). */
const MIN_WRITABLE_PT = 72;

type MarginKey = "marginTop" | "marginBottom" | "marginLeft" | "marginRight";
const marginFields: { key: MarginKey; label: string }[] = [
  { key: "marginTop", label: "Top" },
  { key: "marginBottom", label: "Bottom" },
  { key: "marginLeft", label: "Left" },
  { key: "marginRight", label: "Right" },
];

type PageSetupDialogProps = {
  initial: PageSetup;
  unit: LengthUnit;
  onApply: (setup: PageSetup) => void;
  onCancel: () => void;
};

/** File > Page setup: orientation, paper size and margins of the document. */
export function PageSetupDialog({ initial, unit, onApply, onCancel }: PageSetupDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [orientation, setOrientation] = useState<PageOrientation>(initial.orientation);
  const [paperSize, setPaperSize] = useState<PaperSize>(initial.paperSize);
  const [margins, setMargins] = useState(() =>
    Object.fromEntries(marginFields.map(({ key }) => [key, formatLength(initial[key], unit)])) as Record<MarginKey, string>,
  );
  const [error, setError] = useState<string | null>(null);
  useEffect(() => dialog.current?.showModal(), []);

  const apply = () => {
    const points = {} as Record<MarginKey, number>;
    for (const { key, label } of marginFields) {
      const value = Number(margins[key].replace(",", "."));
      if (margins[key].trim() === "" || !Number.isFinite(value) || value < 0) return setError(`Enter a valid ${label.toLowerCase()} margin.`);
      points[key] = Math.round(value * pointsPerUnit(unit) * 100) / 100;
    }
    const size = pageSizeMm({ paperSize, orientation });
    const widthPt = (size.width * PX_PER_MM) / PX_PER_PT;
    const heightPt = (size.height * PX_PER_MM) / PX_PER_PT;
    if (points.marginLeft + points.marginRight > widthPt - MIN_WRITABLE_PT || points.marginTop + points.marginBottom > heightPt - MIN_WRITABLE_PT) {
      return setError("The margins are too large for the page.");
    }
    onApply({ paperSize, orientation, ...points });
  };

  return (
    <dialog ref={dialog} className="dialog page-setup-dialog" aria-labelledby="page-setup-title" onCancel={onCancel} onClose={onCancel}>
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          apply();
        }}
      >
        <h2 id="page-setup-title">Page setup</h2>
        <div className="page-setup-columns">
          <div>
            <fieldset className="page-setup-group">
              <legend>Orientation</legend>
              {(["portrait", "landscape"] as const).map((value) => (
                <label key={value} className="radio-option">
                  <input
                    type="radio"
                    name="orientation"
                    value={value}
                    checked={orientation === value}
                    onChange={() => setOrientation(value)}
                  />
                  {value === "portrait" ? "Portrait" : "Landscape"}
                </label>
              ))}
            </fieldset>
            <label className="page-setup-group">
              <span className="page-setup-label">Paper size</span>
              <select
                className="select-field"
                aria-label="Paper size"
                value={paperSize}
                onChange={(event) => setPaperSize(event.target.value as PaperSize)}
              >
                {Object.entries(paperSizes).map(([value, paper]) => (
                  <option key={value} value={value}>
                    {paperLabel(paper, unit)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <fieldset className="page-setup-group page-setup-margins">
            <legend>Margins ({unit === "in" ? "inches" : "centimetres"})</legend>
            {marginFields.map(({ key, label }) => (
              <label key={key} className="margin-field">
                <span>{label}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label={label}
                  value={margins[key]}
                  onChange={(event) => {
                    setError(null);
                    setMargins((current) => ({ ...current, [key]: event.target.value }));
                  }}
                  onFocus={(event) => event.target.select()}
                />
              </label>
            ))}
          </fieldset>
        </div>
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
            OK
          </button>
        </div>
      </form>
    </dialog>
  );
}

function formatLength(points: number, unit: LengthUnit): string {
  return String(Math.round((points / pointsPerUnit(unit)) * 100) / 100);
}

function paperLabel(paper: { label: string; width: number; height: number }, unit: LengthUnit): string {
  const size =
    unit === "in"
      ? `${round(paper.width / 25.4)}" x ${round(paper.height / 25.4)}"`
      : `${round(paper.width / 10)} cm x ${round(paper.height / 10)} cm`;
  return `${paper.label} (${size})`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
