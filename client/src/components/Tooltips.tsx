import { useEffect, useLayoutEffect, useRef, useState } from "react";

const SHOW_DELAY_MS = 400;

type Tip = { text: string; left: number; top: number };

/**
 * Shows the `data-tooltip` text of the hovered control in a small label below it,
 * after a short delay. One instance serves the whole app.
 */
export function Tooltips() {
  const [tip, setTip] = useState<Tip | null>(null);
  const element = useRef<HTMLDivElement>(null);

  // Keep the label inside the window, for controls at its edges.
  useLayoutEffect(() => {
    const label = element.current;
    if (!label) return;
    const margin = 4;
    const { left, right } = label.getBoundingClientRect();
    const shift = Math.max(margin - left, 0) + Math.min(innerWidth - margin - right, 0);
    if (shift) label.style.left = `${label.offsetLeft + shift}px`;
  }, [tip]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let target: HTMLElement | null = null;

    const hide = () => {
      clearTimeout(timer);
      target = null;
      setTip(null);
    };
    const onPointerOver = (event: PointerEvent) => {
      const element = (event.target as Element).closest<HTMLElement>("[data-tooltip]");
      if (element === target) return;
      hide();
      if (!element) return;
      target = element;
      timer = setTimeout(() => {
        // No tooltip over the control's own open menu.
        if (element.getAttribute("aria-expanded") === "true" || !element.isConnected) return;
        const rect = element.getBoundingClientRect();
        setTip({ text: element.dataset.tooltip ?? "", left: rect.left + rect.width / 2, top: rect.bottom + 4 });
      }, SHOW_DELAY_MS);
    };

    document.addEventListener("pointerover", onPointerOver);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", hide, true);
    document.addEventListener("scroll", hide, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", hide, true);
      document.removeEventListener("scroll", hide, true);
    };
  }, []);

  if (!tip?.text) return null;
  return (
    <div ref={element} className="tooltip" role="tooltip" style={{ left: tip.left, top: tip.top }}>
      {tip.text}
    </div>
  );
}
