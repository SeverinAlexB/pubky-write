import { useEffect, useState } from "react";
import { Icon } from "../../components/Icon.tsx";
import { MenuList } from "../../components/MenuList.tsx";
import { usePopover } from "../../components/usePopover.ts";

/** A zoom factor, or "fit" to make the page as wide as the editor area. */
export type Zoom = number | "fit";

export const zoomPresets = [0.5, 0.75, 0.9, 1, 1.25, 1.5, 2];
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;

/** The zoom combobox: pick Fit or a preset, or type a percentage and press Enter. */
export function ZoomControl({ zoom, onChange }: { zoom: Zoom; onChange: (zoom: Zoom) => void }) {
  const { open, setOpen, close, root } = usePopover();
  const display = zoom === "fit" ? "Fit" : `${Math.round(zoom * 100)}%`;
  const [draft, setDraft] = useState(display);
  useEffect(() => setDraft(display), [display]);

  const commit = () => {
    const percent = Number.parseFloat(draft);
    if (/^fit$/i.test(draft.trim())) onChange("fit");
    else if (Number.isFinite(percent) && percent > 0) onChange(Math.min(Math.max(percent / 100, MIN_ZOOM), MAX_ZOOM));
    else setDraft(display);
    close();
  };

  return (
    <div className="menu combo zoom-control" ref={root}>
      <input
        className="combo-input"
        role="combobox"
        aria-label="Zoom"
        aria-expanded={open}
        data-tooltip="Zoom"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={(event) => event.target.select()}
        onClick={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            // The zoom returns the focus to the document, which would otherwise receive the Enter.
            event.preventDefault();
            commit();
          }
          if (event.key === "Escape") setDraft(display);
        }}
        onBlur={() => setDraft(display)}
      />
      <button
        type="button"
        className="combo-arrow"
        tabIndex={-1}
        aria-label="Zoom options"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="arrow_drop_down" size={20} />
      </button>
      {open && (
        <MenuList
          label="Zoom"
          className="menu-list-start zoom-menu"
          onClose={close}
          entries={[
            { label: "Fit", onSelect: () => onChange("fit") },
            "separator",
            ...zoomPresets.map((preset) => ({ label: `${Math.round(preset * 100)}%`, onSelect: () => onChange(preset) })),
          ]}
        />
      )}
    </div>
  );
}
