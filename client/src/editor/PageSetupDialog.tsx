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
} from "@pubky-write/shared";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { usePopover } from "../components/usePopover.ts";
import { storePageSetupDefaults } from "../pageSetupDefaults.ts";
import { ColorPalette } from "./toolbar/ColorPicker.tsx";

/** The writable area must stay at least this large, in points (one inch). */
const MIN_WRITABLE_PT = 72;

type MarginKey = "marginTop" | "marginBottom" | "marginLeft" | "marginRight";
const marginFields: { key: MarginKey; label: string }[] = [
  { key: "marginTop", label: "Top" },
  { key: "marginBottom", label: "Bottom" },
  { key: "marginLeft", label: "Left" },
  { key: "marginRight", label: "Right" },
];

type Tab = "pages" | "pageless";
const tabs: { id: Tab; label: string }[] = [
  { id: "pages", label: "Pages" },
  { id: "pageless", label: "Pageless" },
];

type PageSetupDialogProps = {
  initial: PageSetup;
  unit: LengthUnit;
  /** Whether the document is shown in pageless format: the dialog then opens on the Pageless tab. */
  pageless?: boolean;
  onApply: (setup: PageSetup) => void;
  onSwitchToPageless: () => void;
  onCancel: () => void;
};

/**
 * File > Page setup. The Pages tab sets the orientation, paper size, page colour and margins of
 * the document (OK applies them and shows pages); "Set as default" keeps them for new documents.
 * OK on the Pageless tab switches to pageless format.
 */
export function PageSetupDialog({ initial, unit, pageless = false, onApply, onSwitchToPageless, onCancel }: PageSetupDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const tabButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const [tab, setTab] = useState<Tab>(pageless ? "pageless" : "pages");
  const [orientation, setOrientation] = useState<PageOrientation>(initial.orientation);
  const [paperSize, setPaperSize] = useState<PaperSize>(initial.paperSize);
  const [pageColor, setPageColor] = useState(initial.pageColor);
  const [margins, setMargins] = useState(() =>
    Object.fromEntries(marginFields.map(({ key }) => [key, formatLength(initial[key], unit)])) as Record<MarginKey, string>,
  );
  const [error, setError] = useState<string | null>(null);
  const [savedAsDefault, setSavedAsDefault] = useState(false);
  const colour = usePopover();
  useEffect(() => dialog.current?.showModal(), []);

  /** The settings in the form, or null (and an error shown) if a margin is not valid. */
  const readSetup = (): PageSetup | null => {
    const points = {} as Record<MarginKey, number>;
    for (const { key, label } of marginFields) {
      const value = Number(margins[key].replace(",", "."));
      if (margins[key].trim() === "" || !Number.isFinite(value) || value < 0) {
        setError(`Enter a valid ${label.toLowerCase()} margin.`);
        return null;
      }
      points[key] = Math.round(value * pointsPerUnit(unit) * 100) / 100;
    }
    const size = pageSizeMm({ paperSize, orientation });
    const widthPt = (size.width * PX_PER_MM) / PX_PER_PT;
    const heightPt = (size.height * PX_PER_MM) / PX_PER_PT;
    if (points.marginLeft + points.marginRight > widthPt - MIN_WRITABLE_PT || points.marginTop + points.marginBottom > heightPt - MIN_WRITABLE_PT) {
      setError("The margins are too large for the page.");
      return null;
    }
    return { paperSize, orientation, pageColor, ...points };
  };

  const apply = () => {
    if (tab === "pageless") return onSwitchToPageless();
    const setup = readSetup();
    if (setup) onApply(setup);
  };

  const setAsDefault = () => {
    const setup = readSetup();
    if (!setup) return;
    storePageSetupDefaults(setup);
    setSavedAsDefault(true);
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const target = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    const next = (target + tabs.length) % tabs.length;
    setTab(tabs[next]!.id);
    tabButtons.current[next]?.focus();
  };

  return (
    <dialog
      ref={dialog}
      className="dialog page-setup-dialog"
      aria-labelledby="page-setup-title"
      onCancel={onCancel}
      onClose={onCancel}
      onKeyDown={(event) => {
        // Escape closes the colour palette first; preventing it keeps the dialog open.
        if (event.key !== "Escape" || !colour.open) return;
        event.preventDefault();
        colour.close();
      }}
    >
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          apply();
        }}
      >
        <h2 id="page-setup-title">Page setup</h2>
        <div className="page-setup-tabs" role="tablist" aria-label="Format">
          {tabs.map(({ id, label }, index) => (
            <button
              key={id}
              ref={(element) => {
                tabButtons.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`page-setup-tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`page-setup-panel-${id}`}
              tabIndex={tab === id ? 0 : -1}
              className="page-setup-tab"
              onClick={() => setTab(id)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "pages" ? (
          <div role="tabpanel" id="page-setup-panel-pages" aria-labelledby="page-setup-tab-pages" className="page-setup-panel">
            <label className="page-setup-group">
              <span className="page-setup-label">Apply to</span>
              <select className="select-field" aria-label="Apply to" defaultValue="document">
                <option value="document">Whole document</option>
              </select>
            </label>
            <fieldset className="page-setup-group">
              <legend>Orientation</legend>
              <div className="page-setup-radios">
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
              </div>
            </fieldset>
            <div className="page-setup-row">
              <label className="page-setup-group page-setup-paper">
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
              <div className="page-setup-group">
                <span className="page-setup-label" aria-hidden>
                  Page colour
                </span>
                <div className="menu page-colour-menu" ref={colour.root}>
                  <button
                    type="button"
                    className="page-colour-button"
                    aria-label={`Page colour ${pageColor}`}
                    aria-haspopup="dialog"
                    aria-expanded={colour.open}
                    onClick={() => colour.setOpen((open) => !open)}
                  >
                    <span className="page-colour-swatch" style={{ background: pageColor }} />
                  </button>
                  {colour.open && (
                    <ColorPalette
                      label="Page colour"
                      selected={pageColor}
                      allowNone={false}
                      onPick={(color) => {
                        colour.close();
                        if (color) setPageColor(color.toLowerCase());
                      }}
                    />
                  )}
                </div>
              </div>
            </div>
            <fieldset className="page-setup-group page-setup-margins">
              <legend>Margins ({unit === "in" ? "inches" : "centimetres"})</legend>
              <div className="page-setup-margin-row">
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
                        setSavedAsDefault(false);
                        setMargins((current) => ({ ...current, [key]: event.target.value }));
                      }}
                      onFocus={(event) => event.target.select()}
                    />
                  </label>
                ))}
              </div>
            </fieldset>
            {error && (
              <p className="dialog-error" role="alert">
                {error}
              </p>
            )}
          </div>
        ) : (
          <div role="tabpanel" id="page-setup-panel-pageless" aria-labelledby="page-setup-tab-pageless" className="page-setup-panel">
            <p className="page-setup-pageless">
              Pageless format shows the document as one continuous sheet, without breaks between pages. Headers, footers and
              page numbers are not shown. Choose OK to switch to pageless format.
            </p>
          </div>
        )}

        <div className="dialog-actions page-setup-actions">
          {tab === "pages" && (
            <button type="button" className="button-secondary page-setup-default" onClick={setAsDefault}>
              Set as default
            </button>
          )}
          {savedAsDefault && tab === "pages" && (
            <span className="page-setup-saved" role="status">
              Saved as default
            </span>
          )}
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

/** "A4 (21.0 cm x 29.7 cm)", or in inches 'Letter (8.5" x 11")'. */
export function paperLabel(paper: { label: string; width: number; height: number }, unit: LengthUnit): string {
  const size =
    unit === "in"
      ? `${round(paper.width / 25.4)}" x ${round(paper.height / 25.4)}"`
      : `${(paper.width / 10).toFixed(1)} cm x ${(paper.height / 10).toFixed(1)} cm`;
  return `${paper.label} (${size})`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
