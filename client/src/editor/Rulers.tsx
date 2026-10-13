import { INDENT_STEP_PX, type LengthUnit, type PageGeometry } from "@docs/shared";
import type { EditorState } from "@tiptap/pm/state";
import { useEditorState, type Editor } from "@tiptap/react";
import { useLayoutEffect, useRef, useState } from "react";
import { PAGE_GAP } from "./pagination.ts";
import { rulerTicks } from "./rulerScale.ts";

const RULER_SIZE = 16;
/** The bullet or number of a list item sits 20px left of its text. */
const LIST_GLYPH_OFFSET = 20;
const listTypes = new Set(["bulletList", "orderedList", "taskList"]);

type RulerProps = {
  /** The page stack the ruler measures, once it is mounted. */
  stack: HTMLElement | null;
  geometry: PageGeometry;
  zoom: number;
  unit: LengthUnit;
};

/** Indents of the paragraph at the cursor, in pixels from the margins. */
export type ParagraphIndents = { left: number; firstLine: number; right: number };

export function paragraphIndents(state: EditorState): ParagraphIndents {
  const { $from } = state.selection;
  let lists = 0;
  for (let depth = $from.depth; depth > 0; depth--) if (listTypes.has($from.node(depth).type.name)) lists += 1;
  const block = $from.parent;
  const left = lists * INDENT_STEP_PX + ((block.attrs.indent as number | undefined) ?? 0) * INDENT_STEP_PX;
  return { left, firstLine: lists > 0 ? left - LIST_GLYPH_OFFSET : left, right: 0 };
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

/** The ruler above the page: 0 at the left margin, shaded margins, and the current paragraph's indent markers. */
export function HorizontalRuler({ editor, stack, geometry, zoom, unit }: RulerProps & { editor: Editor }) {
  const band = useRef<HTMLDivElement>(null);
  useTrackedLayout([stack, band.current]);
  const indents = useEditorState({
    editor,
    selector: ({ editor: current }) => paragraphIndents(current.state),
    equalityFn: (a, b) => b !== null && a.left === b.left && a.firstLine === b.firstLine && a.right === b.right,
  });

  const left = stack && band.current ? stack.getBoundingClientRect().left - band.current.getBoundingClientRect().left : null;
  const width = geometry.width * zoom;
  const start = geometry.marginLeft * zoom;
  const end = (geometry.width - geometry.marginRight) * zoom;
  const ticks = rulerTicks({ length: geometry.width, origin: geometry.marginLeft, unit, zoom });
  const firstLine = start + indents.firstLine * zoom;
  const leftIndent = start + indents.left * zoom;
  const rightIndent = end - indents.right * zoom;

  return (
    <div className="ruler-band" ref={band}>
      {left !== null && (
        <svg
          className="ruler horizontal-ruler"
          role="img"
          aria-label="Ruler"
          width={width}
          height={RULER_SIZE}
          style={{ left }}
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
          <rect className="ruler-marker first-line-indent" x={firstLine - 5} y={0} width={10} height={4} rx={1}>
            <title>First line indent</title>
          </rect>
          <polygon className="ruler-marker left-indent" points={`${leftIndent - 5},6 ${leftIndent + 5},6 ${leftIndent},12`}>
            <title>Left indent</title>
          </polygon>
          <polygon className="ruler-marker right-indent" points={`${rightIndent - 5},6 ${rightIndent + 5},6 ${rightIndent},12`}>
            <title>Right indent</title>
          </polygon>
        </svg>
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
