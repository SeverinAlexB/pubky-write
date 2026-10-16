import { pointsPerUnit, PX_PER_PT, type LengthUnit } from "@pubky-write/shared";

export type RulerTick = {
  /** Distance from the page edge in screen pixels (zoom applied). */
  offset: number;
  kind: "label" | "half" | "minor";
  /** Whole units from the margin: negative inside the start margin. Only on labelled ticks. */
  label?: string;
};

/** Ticks per unit: quarter centimetres, eighth inches. */
const subdivisions: Record<LengthUnit, number> = { cm: 4, in: 8 };
/** Below this many screen pixels per unit only every other unit is numbered. */
const MIN_LABEL_SPACING = 28;

/**
 * The ticks of a ruler along a page edge `length` pixels long, counting from `origin`
 * (the margin, where the ruler shows 0).
 */
export function rulerTicks({
  length,
  origin,
  unit,
  zoom,
}: {
  length: number;
  origin: number;
  unit: LengthUnit;
  zoom: number;
}): RulerTick[] {
  const per = subdivisions[unit];
  const unitPx = pointsPerUnit(unit) * PX_PER_PT;
  const step = unitPx / per;
  const labelEvery = unitPx * zoom < MIN_LABEL_SPACING ? 2 : 1;
  const ticks: RulerTick[] = [];
  for (let index = Math.ceil(-origin / step - 1e-6); origin + index * step <= length + 1e-6; index++) {
    const offset = (origin + index * step) * zoom;
    if (index % per === 0) {
      const value = index / per;
      // 0 is marked by the indent markers rather than a number.
      if (value !== 0 && value % labelEvery === 0) ticks.push({ offset, kind: "label", label: String(value) });
    } else if (zoom >= 0.5 || index % (per / 2) === 0) {
      ticks.push({ offset, kind: index % (per / 2) === 0 ? "half" : "minor" });
    }
  }
  return ticks;
}
