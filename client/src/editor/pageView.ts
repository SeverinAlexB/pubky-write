// Hooks shared by the editor and the version history preview.
import { paperSizes, type PageSetup } from "@docs/shared";
import { useEffect, useState } from "react";

/** Space kept on each side of the page when zoomed to fit. */
const FIT_MARGIN = 16;

/**
 * The zoom at which a page `pageWidth` pixels wide (borders included) is as wide as the scrolling
 * area, minus `reserved` pixels beside it. Attach `ref` to the scrolling area.
 */
export function useFitZoom(pageWidth: number, reserved: number) {
  const [areaWidth, setAreaWidth] = useState<number | null>(null);
  const [element, ref] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(() => setAreaWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return { value: areaWidth === null ? 1 : (areaWidth - reserved - 2 * FIT_MARGIN) / pageWidth, ref, element };
}

/** Printing uses the document's paper size and margins. */
export function usePrintPageRule(setup: PageSetup, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const style = document.createElement("style");
    const paper = paperSizes[setup.paperSize];
    const [width, height] = setup.orientation === "landscape" ? [paper.height, paper.width] : [paper.width, paper.height];
    const margins = [setup.marginTop, setup.marginRight, setup.marginBottom, setup.marginLeft].map((points) => `${points}pt`);
    style.textContent = `@page { size: ${width}mm ${height}mm; margin: ${margins.join(" ")}; }`;
    style.dataset.pageSetup = "";
    document.head.append(style);
    return () => style.remove();
  }, [setup, enabled]);
}
