import { pageSetupOf, PX_PER_PT, type LengthUnit, type PageGeometry } from "@docs/shared";
import { closeHistory } from "@tiptap/pm/history";
import { useEditorState, type Editor } from "@tiptap/react";
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { PAGE_GAP } from "./pagination.ts";
import {
  clampHandle,
  dragLabel,
  handleLabels,
  rulerIndents,
  setIndentTransaction,
  snap,
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

/** A marker or margin being dragged: where it is now, in points, and where the pointer started. */
type Drag = {
  handle: RulerHandle;
  value: number;
  startValue: number;
  startX: number;
  indents: RulerIndents;
};

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
 * indent markers. The markers can be dragged to change the indents of the selected paragraphs of
 * `paragraphEditor` (the body, or the header, footer or footnote being edited), and the margin
 * areas to change the page margins of `editor`'s document. While dragging, a dotted line runs down
 * the page and a tooltip shows the value; values snap to the ruler's ticks unless Alt is held.
 */
export function HorizontalRuler({
  editor,
  paragraphEditor,
  stack,
  geometry,
  zoom,
  unit,
}: RulerProps & { editor: Editor; paragraphEditor: Editor }) {
  const band = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
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

  const startDrag = (handle: RulerHandle, event: ReactPointerEvent<SVGElement>) => {
    if (event.button !== 0) return;
    // Keep the focus and selection in the document.
    event.preventDefault();
    event.stopPropagation();
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

  const moveDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const setup = pageSetupOf(editor.state.doc);
    const pageWidth = geometry.width / PX_PER_PT;
    // Right-hand handles count from the right, so moving right makes them smaller.
    const direction = drag.handle === "rightIndent" || drag.handle === "marginRight" ? -1 : 1;
    const moved = drag.startValue + (direction * (event.clientX - drag.startX)) / pxPerPt;
    const value = clampHandle(drag.handle, event.altKey ? moved : snap(moved, unit), {
      indents: drag.indents,
      contentWidth: pageWidth - setup.marginLeft - setup.marginRight,
      pageWidth,
      margins: { left: setup.marginLeft, right: setup.marginRight },
    });
    if (value !== drag.value) setDrag({ ...drag, value });
  };

  const endDrag = (apply: boolean) => {
    if (!drag) return;
    setDrag(null);
    if (!apply || Math.abs(drag.value - drag.startValue) < 0.01) return;
    const value = Math.round(drag.value * 100) / 100;
    if (drag.handle === "marginLeft" || drag.handle === "marginRight") {
      editor.view.dispatch(closeHistory(editor.state.tr).setDocAttribute(drag.handle, value));
      return;
    }
    const transaction = setIndentTransaction(paragraphEditor.state, drag.handle, value);
    if (transaction) paragraphEditor.view.dispatch(transaction);
  };

  // The guide line and tooltip at the dragged marker or margin edge.
  const svgLeft = svg.current?.getBoundingClientRect().left ?? 0;
  const bandRect = band.current?.getBoundingClientRect();
  const dragX =
    drag &&
    svgLeft +
      {
        leftIndent: leftIndent,
        firstLineIndent: firstLine,
        rightIndent: rightIndent,
        marginLeft: start,
        marginRight: end,
      }[drag.handle];

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
          <rect className="ruler-writable" x={start} y={0} width={Math.max(0, end - start)} height={RULER_SIZE} />
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
          <rect
            className="ruler-marker first-line-indent"
            x={firstLine - 5}
            y={0}
            width={10}
            height={4}
            rx={1}
            onPointerDown={(event) => startDrag("firstLineIndent", event)}
          >
            <title>{handleLabels.firstLineIndent}</title>
          </rect>
          <polygon
            className="ruler-marker left-indent"
            points={`${leftIndent - 5},6 ${leftIndent + 5},6 ${leftIndent},12`}
            onPointerDown={(event) => startDrag("leftIndent", event)}
          >
            <title>{handleLabels.leftIndent}</title>
          </polygon>
          <polygon
            className="ruler-marker right-indent"
            points={`${rightIndent - 5},6 ${rightIndent + 5},6 ${rightIndent},12`}
            onPointerDown={(event) => startDrag("rightIndent", event)}
          >
            <title>{handleLabels.rightIndent}</title>
          </polygon>
        </svg>
      )}
      {drag &&
        dragX !== null &&
        bandRect &&
        createPortal(
          <>
            <div className="ruler-guide" style={{ left: dragX, top: bandRect.bottom }} aria-hidden />
            <div className="ruler-tooltip" role="status" style={{ left: dragX, top: bandRect.bottom + 6 }}>
              {dragLabel(drag.handle, drag.value, drag.indents, unit)}
            </div>
          </>,
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
