import { describe, expect, it } from "vitest";
import { rulerTicks } from "./rulerScale.ts";

describe("rulerTicks", () => {
  it("numbers centimetres from the left margin of an A4 page, negative in the margin", () => {
    const ticks = rulerTicks({ length: 794, origin: 96, unit: "cm", zoom: 1 });
    const labels = ticks.filter((tick) => tick.kind === "label");
    expect(labels.map((tick) => tick.label)).toEqual(["-2", "-1", ...Array.from({ length: 18 }, (_, i) => String(i + 1))]);
    expect(labels.find((tick) => tick.label === "1")!.offset).toBeCloseTo(96 + 37.795, 2);
    expect(labels.find((tick) => tick.label === "-1")!.offset).toBeCloseTo(96 - 37.795, 2);
    // Quarter centimetres, with a longer tick at each half.
    expect(ticks.filter((tick) => tick.kind === "half")).toHaveLength(21);
    expect(ticks[0]!.offset).toBeGreaterThanOrEqual(0);
    expect(ticks.at(-1)!.offset).toBeLessThanOrEqual(794);
  });

  it("uses eighths of an inch and applies the zoom", () => {
    const ticks = rulerTicks({ length: 816, origin: 96, unit: "in", zoom: 2 });
    expect(ticks.find((tick) => tick.label === "1")!.offset).toBeCloseTo((96 + 96) * 2, 5);
    expect(ticks.filter((tick) => tick.kind === "label").map((tick) => tick.label)).toEqual(["-1", ...["1", "2", "3", "4", "5", "6", "7"]]);
  });

  it("numbers every other unit when zoomed out", () => {
    const labels = rulerTicks({ length: 794, origin: 96, unit: "cm", zoom: 0.5 }).filter((tick) => tick.kind === "label");
    expect(labels.map((tick) => tick.label)).toEqual(["-2", "2", "4", "6", "8", "10", "12", "14", "16", "18"]);
  });
});
