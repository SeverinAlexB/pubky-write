import {
  encodeTabStops,
  pageSetupOf,
  PX_PER_PT,
  sameTabStop,
  type LengthUnit,
  type PageGeometry,
  type TabStop,
  type TabStopKind,
} from "@docs/shared";
import { closeHistory } from "@tiptap/pm/history";
import { useEditorState, type Editor } from "@tiptap/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { MenuList } from "../components/MenuList.tsx";
import { useDismiss } from "../components/useDismiss.ts";
import { PAGE_GAP } from "./pagination.ts";
import {
  changeTabStopsTransaction,
  clampHandle,
  dragLabel,
  handleLabels,
  rulerIndents,
  rulerTabStops,
  setIndentTransaction,
  snap,
  tabStopLabel,
  type RulerHandle,
  type RulerIndents,
} from "./rulerDrag.ts";
import { rulerTicks } from "./rulerScale.ts";

const RULER_SIZE = 16;

type RulerProps = {
  /** The page stack the ruler measures, once it is mounted. */
  stack: HTMLElement | null;
  geometry: PageGeometry;
  zoom: number;
  unit: LengthUnit;
};

/** A marker, margin or tab stop being dragged: where it is now, in points, and where the pointer started. */
type Drag = {
  handle: RulerHandle | "tabStop";
  value: number;
  startValue: number;
  startX: number;
  indents: RulerIndents;
  /** The tab stop being dragged. */
  stop?: TabStop;
  /** A tab stop dragged off the ruler, which removes it when released there. */
  off?: boolean;
};

/** A tab stop dragged this far above or below the ruler is removed. */
const REMOVE_DISTANCE = 20;
/** Markers can be grabbed this far around their shape. */
const HIT_SLOP = 8;

const addTabStopItems: { kind: TabStopKind; label: string }[] = [
  { kind: "left", label: "Add left tab-stop" },
  { kind: "center", label: "Add centre tab-stop" },
  { kind: "right", label: "Add right tab-stop" },
];

const tabStopTitles: Record<TabStopKind, string> = { left: "Left tab-stop", center: "Centre tab-stop", right: "Right tab-stop" };

/** The outline of a tab stop marker at `x`: ▶ for left, ◀ for right and ◆ for centre stops. */
function tabStopPoints(kind: TabStopKind, x: number): string {
  if (kind === "left") return `${x},5 ${x + 5},10 ${x},15`;
  if (kind === "right") return `${x},5 ${x - 5},10 ${x},15`;
  return `${x},5 ${x + 5.5},10 ${x},15 ${x - 5.5},10`;
}

/** Re-renders when `elements` move or resize, or the editor area scrolls. */
function useTrackedLayout(elements: (Element | null)[]): number {
  const [revision, setRevision] = useState(0);
  useLayoutEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setRevision((value) => value + 1));
    };
    const observer = new ResizeObserver(update);
    for (const element of elements) if (element) observer.observe(element);
    const scroller = elements.find(Boolean)?.closest(".editor-scroll");
    if (scroller) observer.observe(scroller);
    // The comment margin moves the pages sideways without resizing them.
    const column = scroller?.querySelector(".page-column");
    if (column) observer.observe(column);
    scroller?.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      scroller?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, elements);
  return revision;
}

/**
 * The ruler above the page: 0 at the left margin, shaded margins, and the current paragraph's
 * indent markers and tab stops. The markers can be dragged to change the indents of the selected
 * paragraphs of `paragraphEditor` (the body, or the header, footer or footnote being edited), the
 * margin areas to change the page margins of `editor`'s document. While dragging, a dotted line
 * runs down the page and a tooltip shows the value; values snap to the ruler's ticks unless Alt is
 * held. A click on the writable area opens a menu that adds a tab stop there; a tab stop dragged
 * off the ruler is removed.
 */
export function HorizontalRuler({
  editor,
  paragraphEditor,
  stack,
  geometry,
  zoom,
  unit,
  onToggleRuler,
}: RulerProps & { editor: Editor; paragraphEditor: Editor; onToggleRuler?: () => void }) {
  const band = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const menuRoot = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  /** The tab stop menu: where it opens, and the position (in points from the margin) it adds a stop at. */
  const [menu, setMenu] = useState<{ x: number; y: number; pos: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  useDismiss(menuRoot, menu !== null, closeMenu);
  useTrackedLayout([stack, band.current]);
  // Escape cancels a drag.
  useEffect(() => {
    if (!drag) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setDrag(null);
    };
    window.addEventListener("keydown", cancel, true);
    return () => window.removeEventListener("keydown", cancel, true);
  }, [drag !== null]);
  const indents = useEditorState({
    editor: paragraphEditor,
    selector: ({ editor: current }) => rulerIndents(current.state),
    equalityFn: (a, b) => b !== null && a.left === b.left && a.firstLine === b.firstLine && a.right === b.right,
  });
  const tabStops = useEditorState({
    editor: paragraphEditor,
    selector: ({ editor: current }) => rulerTabStops(current.state),
    equalityFn: (a, b) => b !== null && encodeTabStops(a) === encodeTabStops(b),
  });

  const left = stack && band.current ? stack.getBoundingClientRect().left - band.current.getBoundingClientRect().left : null;
  const pxPerPt = PX_PER_PT * zoom;
  const width = geometry.width * zoom;
  // While a margin is dragged the ruler shows the new margin; indents keep their distance to it.
  const marginLeft = drag?.handle === "marginLeft" ? drag.value * PX_PER_PT : geometry.marginLeft;
  const marginRight = drag?.handle === "marginRight" ? drag.value * PX_PER_PT : geometry.marginRight;
  const start = marginLeft * zoom;
  const end = (geometry.width - marginRight) * zoom;
  const ticks = rulerTicks({ length: geometry.width, origin: marginLeft, unit, zoom });

  // The markers, moved by the drag in progress.
  let shown = indents;
  if (drag?.handle === "leftIndent") shown = { ...indents, left: drag.value, firstLine: drag.value + drag.indents.firstLine - drag.indents.left };
  if (drag?.handle === "firstLineIndent") shown = { ...indents, firstLine: drag.value };
  if (drag?.handle === "rightIndent") shown = { ...indents, right: drag.value };
  const firstLine = start + shown.firstLine * pxPerPt;
  const leftIndent = start + shown.left * pxPerPt;
  const rightIndent = end - shown.right * pxPerPt;
  // The dragged tab stop is drawn where it is now, and not at all while it is off the ruler.
  const shownStops = tabStops.flatMap((stop) => {
    if (!drag?.stop || !sameTabStop(stop, drag.stop)) return [stop];
    return drag.off ? [] : [{ ...stop, pos: drag.value }];
  });

  /** The width between the margins, in points. */
  const contentWidth = () => {
    const setup = pageSetupOf(editor.state.doc);
    return geometry.width / PX_PER_PT - setup.marginLeft - setup.marginRight;
  };

  const startDrag = (handle: RulerHandle, event: ReactPointerEvent<SVGElement>) => {
    if (event.button !== 0) return;
    // Keep the focus and selection in the document.
    event.preventDefault();
    event.stopPropagation();
    setMenu(null);
    svg.current?.setPointerCapture(event.pointerId);
    const setup = pageSetupOf(editor.state.doc);
    const startValue = {
      leftIndent: indents.left,
      firstLineIndent: indents.firstLine,
      rightIndent: indents.right,
      marginLeft: setup.marginLeft,
      marginRight: setup.marginRight,
    }[handle];
    setDrag({ handle, value: startValue, startValue, startX: event.clientX, indents });
  };

  const startTabStopDrag = (stop: TabStop, event: ReactPointerEvent<SVGElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setMenu(null);
    svg.current?.setPointerCapture(event.pointerId);
    setDrag({ handle: "tabStop", value: stop.pos, startValue: stop.pos, startX: event.clientX, indents, stop });
  };

  const moveDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const moved = (direction: number) => drag.startValue + (direction * (event.clientX - drag.startX)) / pxPerPt;
    if (drag.handle === "tabStop") {
      const bounds = band.current!.getBoundingClientRect();
      const off = event.clientY < bounds.top - REMOVE_DISTANCE || event.clientY > bounds.bottom + REMOVE_DISTANCE;
      const value = Math.min(Math.max(event.altKey ? moved(1) : snap(moved(1), unit), 0), contentWidth());
      if (value !== drag.value || off !== drag.off) setDrag({ ...drag, value, off });
      return;
    }
    const setup = pageSetupOf(editor.state.doc);
    // Right-hand handles count from the right, so moving right makes them smaller.
    const direction = drag.handle === "rightIndent" || drag.handle === "marginRight" ? -1 : 1;
    const value = clampHandle(drag.handle, event.altKey ? moved(direction) : snap(moved(direction), unit), {
      indents: drag.indents,
      contentWidth: contentWidth(),
      pageWidth: geometry.width / PX_PER_PT,
      margins: { left: setup.marginLeft, right: setup.marginRight },
    });
    if (value !== drag.value) setDrag({ ...drag, value });
  };

  const endDrag = (apply: boolean) => {
    if (!drag) return;
    setDrag(null);
    if (!apply) return;
    const value = Math.round(drag.value * 100) / 100;
    if (drag.handle === "tabStop") {
      const stop = drag.stop!;
      const change = drag.off ? { remove: stop } : Math.abs(value - stop.pos) < 0.01 ? null : { remove: stop, add: { ...stop, pos: value } };
      const transaction = change && changeTabStopsTransaction(paragraphEditor.state, change);
      if (transaction) paragraphEditor.view.dispatch(transaction);
      return;
    }
    if (Math.abs(drag.value - drag.startValue) < 0.01) return;
    if (drag.handle === "marginLeft" || drag.handle === "marginRight") {
      editor.view.dispatch(closeHistory(editor.state.tr).setDocAttribute(drag.handle, value));
      return;
    }
    const transaction = setIndentTransaction(paragraphEditor.state, drag.handle, value);
    if (transaction) paragraphEditor.view.dispatch(transaction);
  };

  // A click on the writable area (not on a marker) opens the tab stop menu below it.
  const openMenu = (event: ReactMouseEvent<SVGRectElement>) => {
    const bounds = band.current?.getBoundingClientRect();
    const svgLeft = svg.current?.getBoundingClientRect().left;
    if (!bounds || svgLeft === undefined) return;
    const pos = (event.clientX - svgLeft - start) / pxPerPt;
    const snapped = Math.min(Math.max(event.altKey ? pos : snap(pos, unit), 0), contentWidth());
    setMenu({ x: event.clientX, y: bounds.bottom + 4, pos: snapped });
  };

  const addTabStop = (kind: TabStopKind) => {
    if (!menu) return;
    const transaction = changeTabStopsTransaction(paragraphEditor.state, { add: { pos: Math.round(menu.pos * 100) / 100, kind } });
    if (transaction) paragraphEditor.view.dispatch(transaction);
  };

  // The guide line and tooltip at the dragged marker, margin edge or tab stop.
  const svgLeft = svg.current?.getBoundingClientRect().left ?? 0;
  const bandRect = band.current?.getBoundingClientRect();
  const dragX =
    drag &&
    !drag.off &&
    svgLeft +
      {
        leftIndent: leftIndent,
        firstLineIndent: firstLine,
        rightIndent: rightIndent,
        marginLeft: start,
        marginRight: end,
        tabStop: start + drag.value * pxPerPt,
      }[drag.handle];

  /** An invisible area around a marker's shape that can be grabbed. */
  const hitArea = (
    className: string,
    title: string,
    [x, y, hitWidth, hitHeight]: [number, number, number, number],
    onDown: (event: ReactPointerEvent<SVGElement>) => void,
  ) => (
    <rect className={`ruler-hit ${className}`} x={x} y={y} width={hitWidth} height={hitHeight} onPointerDown={onDown}>
      <title>{title}</title>
    </rect>
  );

  return (
    <div className="ruler-band" ref={band}>
      {left !== null && (
        <svg
          ref={svg}
          className={`ruler horizontal-ruler${drag ? " is-dragging" : ""}`}
          role="img"
          aria-label="Ruler"
          width={width}
          height={RULER_SIZE}
          style={{ left }}
          onPointerMove={moveDrag}
          onPointerUp={() => endDrag(true)}
          onPointerCancel={() => endDrag(false)}
        >
          <rect className="ruler-margin" x={0} y={0} width={width} height={RULER_SIZE} />
          <rect
            className="ruler-writable"
            x={start}
            y={0}
            width={Math.max(0, end - start)}
            height={RULER_SIZE}
            onPointerDown={(event) => {
              // Keep the focus and selection in the document.
              if (event.button === 0) event.preventDefault();
            }}
            onClick={openMenu}
          />
          {ticks.map((tick) =>
            tick.kind === "label" ? (
              <text key={tick.offset} className="ruler-label" x={tick.offset} y={12}>
                {tick.label}
              </text>
            ) : (
              <line
                key={tick.offset}
                className="ruler-tick"
                x1={tick.offset}
                x2={tick.offset}
                y1={tick.kind === "half" ? 5 : 7}
                y2={tick.kind === "half" ? 11 : 9}
              />
            ),
          )}
          {/* The margin areas, for dragging the margins. */}
          <rect
            className="ruler-margin-handle margin-left"
            x={0}
            y={0}
            width={Math.max(0, start)}
            height={RULER_SIZE}
            onPointerDown={(event) => startDrag("marginLeft", event)}
          >
            <title>{handleLabels.marginLeft}</title>
          </rect>
          <rect
            className="ruler-margin-handle margin-right"
            x={end}
            y={0}
            width={Math.max(0, width - end)}
            height={RULER_SIZE}
            onPointerDown={(event) => startDrag("marginRight", event)}
          >
            <title>{handleLabels.marginRight}</title>
          </rect>
          {shownStops.map((stop) => {
            const x = start + stop.pos * pxPerPt;
            return (
              <g key={`${stop.kind}:${stop.pos}`}>
                <polygon className={`ruler-marker tab-stop is-${stop.kind}`} points={tabStopPoints(stop.kind, x)} data-pos={stop.pos} />
                {hitArea(`tab-stop-hit is-${stop.kind}`, tabStopTitles[stop.kind], [x - 8, 2, 16, 16], (event) => startTabStopDrag(stop, event))}
              </g>
            );
          })}
          {/* The indent markers are drawn over tab stops at the same place. */}
          <rect className="ruler-marker first-line-indent" x={firstLine - 5} y={0} width={10} height={4} rx={1} />
          <polygon className="ruler-marker left-indent" points={`${leftIndent - 5},6 ${leftIndent + 5},6 ${leftIndent},12`} />
          <polygon className="ruler-marker right-indent" points={`${rightIndent - 5},6 ${rightIndent + 5},6 ${rightIndent},12`} />
          {/* Grab areas: the first line marker takes the upper half, the left indent the lower one. */}
          {hitArea("right-indent-hit", handleLabels.rightIndent, [rightIndent - 5 - HIT_SLOP, 6 - HIT_SLOP, 10 + 2 * HIT_SLOP, 6 + 2 * HIT_SLOP], (event) =>
            startDrag("rightIndent", event),
          )}
          {hitArea("left-indent-hit", handleLabels.leftIndent, [leftIndent - 5 - HIT_SLOP, 5, 10 + 2 * HIT_SLOP, 7 + HIT_SLOP], (event) =>
            startDrag("leftIndent", event),
          )}
          {hitArea("first-line-indent-hit", handleLabels.firstLineIndent, [firstLine - 5 - HIT_SLOP, -HIT_SLOP, 10 + 2 * HIT_SLOP, 5 + HIT_SLOP], (event) =>
            startDrag("firstLineIndent", event),
          )}
        </svg>
      )}
      {drag &&
        dragX !== null &&
        dragX !== false &&
        bandRect &&
        createPortal(
          <>
            <div className="ruler-guide" style={{ left: dragX, top: bandRect.bottom }} aria-hidden />
            {drag.handle === "tabStop" ? (
              <div className="ruler-tooltip is-above" role="status" style={{ left: dragX, top: bandRect.top - 6 }}>
                {tabStopLabel(drag.value, unit)}
              </div>
            ) : (
              <div className="ruler-tooltip" role="status" style={{ left: dragX, top: bandRect.bottom + 6 }}>
                {dragLabel(drag.handle, drag.value, drag.indents, unit)}
              </div>
            )}
          </>,
          document.body,
        )}
      {menu &&
        createPortal(
          <div ref={menuRoot} className="ruler-menu">
            <MenuList
              label="Ruler"
              at={{ x: menu.x, y: menu.y }}
              onClose={closeMenu}
              entries={[
                ...addTabStopItems.map(({ kind, label }) => ({ label, onSelect: () => addTabStop(kind) })),
                { label: "Show ruler", checked: true, onSelect: onToggleRuler },
              ]}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}

/** The ruler at the left of the editor area, for the page at the top of the view. */
export function VerticalRuler({ stack, geometry, zoom, unit }: RulerProps) {
  const column = useRef<HTMLDivElement>(null);
  useTrackedLayout([stack, column.current]);
  if (!stack || !column.current) return <div className="vertical-ruler" ref={column} aria-hidden />;

  const columnRect = column.current.getBoundingClientRect();
  const stackTop = stack.getBoundingClientRect().top - columnRect.top;
  const stride = (geometry.height + PAGE_GAP) * zoom;
  const pageCount = Number(stack.dataset.pageCount) || 1;
  // The page that fills the upper part of the view.
  const index = Math.min(Math.max(Math.floor((columnRect.height / 3 - stackTop) / stride), 0), pageCount - 1);
  const top = stackTop + index * stride;
  const height = geometry.height * zoom;
  const start = geometry.marginTop * zoom;
  const end = (geometry.height - geometry.marginBottom) * zoom;
  const ticks = rulerTicks({ length: geometry.height, origin: geometry.marginTop, unit, zoom });

  return (
    <div className="vertical-ruler" ref={column} aria-hidden>
      <svg className="ruler" width={RULER_SIZE} height={height} style={{ top }}>
        <rect className="ruler-margin" x={0} y={0} width={RULER_SIZE} height={height} />
        <rect className="ruler-writable" x={0} y={start} width={RULER_SIZE} height={Math.max(0, end - start)} />
        {ticks.map((tick) =>
          tick.kind === "label" ? (
            <text key={tick.offset} className="ruler-label" x={8} y={tick.offset + 3.5}>
              {tick.label}
            </text>
          ) : (
            <line
              key={tick.offset}
              className="ruler-tick"
              y1={tick.offset}
              y2={tick.offset}
              x1={tick.kind === "half" ? 5 : 7}
              x2={tick.kind === "half" ? 11 : 9}
            />
          ),
        )}
      </svg>
    </div>
  );
}
