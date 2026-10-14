// The icon presets of Insert > Page elements > Page numbers and Table of contents.
import type { TocStyle } from "@docs/shared";
import type { ReactNode } from "react";
import type { PageNumberOptions } from "./pageElementCommands.ts";

export const pageNumberPresets: { label: string; options: PageNumberOptions }[] = [
  { label: "Header, right, all pages", options: { position: "header", showOnFirstPage: true } },
  { label: "Header, right, skip first page", options: { position: "header", showOnFirstPage: false } },
  { label: "Footer, right, all pages", options: { position: "footer", showOnFirstPage: true } },
  { label: "Footer, right, skip first page", options: { position: "footer", showOnFirstPage: false } },
];

type PageNumbersPanelProps = {
  onPreset: (options: PageNumberOptions) => void;
  onMoreOptions: () => void;
  onPageCount: () => void;
};

export function PageNumbersPanel({ onPreset, onMoreOptions, onPageCount }: PageNumbersPanelProps) {
  return (
    <div onMouseDown={(event) => event.preventDefault()}>
      <div className="preset-grid">
        {pageNumberPresets.map(({ label, options }) => (
          <button
            key={label}
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="preset-tile"
            aria-label={label}
            data-tooltip={label}
            onClick={() => onPreset(options)}
          >
            <PageNumberIcon position={options.position} skipFirst={!options.showOnFirstPage} />
          </button>
        ))}
      </div>
      <div className="preset-panel-items">
        <button type="button" role="menuitem" tabIndex={-1} className="menu-item" onClick={onMoreOptions}>
          <span className="menu-item-icon" />
          <span className="menu-item-label">More options</span>
        </button>
        <button type="button" role="menuitem" tabIndex={-1} className="menu-item" onClick={onPageCount}>
          <span className="menu-item-icon" />
          <span className="menu-item-label">Page count</span>
        </button>
      </div>
    </div>
  );
}

export const tocPresets: { label: string; style: TocStyle }[] = [
  { label: "Plain text", style: "plain" },
  { label: "Dotted", style: "dotted" },
  { label: "With blue links", style: "links" },
];

export function TableOfContentsPanel({ onPick }: { onPick: (style: TocStyle) => void }) {
  return (
    <div className="preset-grid is-toc" onMouseDown={(event) => event.preventDefault()}>
      {tocPresets.map(({ label, style }) => (
        <button
          key={style}
          type="button"
          role="menuitem"
          tabIndex={-1}
          className="preset-tile"
          aria-label={label}
          data-tooltip={label}
          onClick={() => onPick(style)}
        >
          <TocIcon style={style} />
        </button>
      ))}
    </div>
  );
}

/** A page with text lines and a number box in its header or footer; a second page when the first is skipped. */
function PageNumberIcon({ position, skipFirst }: { position: "header" | "footer"; skipFirst: boolean }) {
  const page = (x: number, y: number, numbered: boolean, key: string): ReactNode => (
    <g key={key} transform={`translate(${x} ${y})`}>
      <rect x="0.5" y="0.5" width="43" height="59" rx="2" fill="#fff" stroke="#80868b" />
      {[16, 22, 28, 34, 40].map((lineY) => (
        <rect key={lineY} x="7" y={lineY} width={lineY === 40 ? 18 : 30} height="2" fill="#c4c7c5" />
      ))}
      {numbered && <rect x="31" y={position === "header" ? 5 : 49} width="7" height="6" fill="#0b57d0" />}
    </g>
  );
  return (
    <svg viewBox="0 0 56 76" aria-hidden>
      {skipFirst ? [page(11, 15, true, "back"), page(1, 1, false, "front")] : page(6, 8, true, "page")}
    </svg>
  );
}

function TocIcon({ style }: { style: TocStyle }) {
  const rows = [8, 18, 28, 38, 48, 58];
  return (
    <svg viewBox="0 0 56 76" aria-hidden>
      <rect x="0.5" y="0.5" width="55" height="75" rx="2" fill="#fff" stroke="#80868b" />
      {rows.map((y, index) => {
        const indent = index % 3 === 0 ? 6 : 12;
        if (style === "links") return <rect key={y} x={indent} y={y + 4} width={34 - indent} height="2" fill="#1a73e8" />;
        return (
          <g key={y}>
            <rect x={indent} y={y + 4} width={22 - indent} height="2" fill="#5f6368" />
            {style === "dotted" &&
              Array.from({ length: 6 }, (_, dot) => <rect key={dot} x={26 + dot * 3.5} y={y + 5} width="1.5" height="1.5" fill="#5f6368" />)}
            <rect x="47" y={y + 3} width="4" height="4" fill="#5f6368" />
          </g>
        );
      })}
    </svg>
  );
}
