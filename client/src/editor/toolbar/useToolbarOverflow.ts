import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/** Space between toolbar items (the CSS gap of .toolbar-items). */
const GAP = 2;
/** Room needed for the "More" button when some items do not fit. */
const MORE_BUTTON_WIDTH = 32;

/**
 * Splits the toolbar's items into those that fit in the bar and those shown in
 * the "More" row. Returns the ref for the element holding the visible items and
 * how many items are visible.
 */
export function useToolbarOverflow(itemCount: number) {
  const bar = useRef<HTMLDivElement>(null);
  /** Item widths, measured while each item was in the bar; they do not change. */
  const widths = useRef<number[]>([]);
  const [visibleCount, setVisibleCount] = useState(itemCount);

  const update = useCallback(() => {
    const element = bar.current;
    if (!element) return;
    Array.from(element.children).forEach((child, index) => {
      widths.current[index] = child.getBoundingClientRect().width + GAP;
    });
    setVisibleCount((current) => {
      // While "More" is shown the bar is narrower by its width.
      const available = element.clientWidth + (current < itemCount ? MORE_BUTTON_WIDTH : 0);
      return fittingCount(widths.current, itemCount, available);
    });
  }, [itemCount]);

  useLayoutEffect(update);

  useEffect(() => {
    const toolbar = bar.current?.parentElement;
    if (!toolbar) return;
    const observer = new ResizeObserver(update);
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, [update]);

  return { bar, visibleCount };
}

function fittingCount(widths: number[], count: number, available: number): number {
  const width = (index: number) => widths[index] ?? 30;
  let total = 0;
  for (let index = 0; index < count; index++) total += width(index);
  if (total <= available) return count;

  const room = available - MORE_BUTTON_WIDTH;
  let used = 0;
  let fitting = 0;
  while (fitting < count && used + width(fitting) <= room) used += width(fitting++);
  return fitting;
}
