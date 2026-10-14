import { describe, expect, it } from "vitest";
import { croppedBy, rotationAt } from "./imageView.ts";

describe("rotationAt", () => {
  it("measures the angle from straight up, clockwise", () => {
    expect(rotationAt(0, -100, false)).toBe(0);
    expect(rotationAt(100, 0, false)).toBe(90);
    expect(rotationAt(0, 100, false)).toBe(180);
    expect(rotationAt(-100, 0, false)).toBe(270);
    expect(rotationAt(100 * Math.sin(0.7), -100 * Math.cos(0.7), false)).toBe(40);
  });

  it("snaps to multiples of 15° with Shift", () => {
    expect(rotationAt(100 * Math.sin(0.7), -100 * Math.cos(0.7), true)).toBe(45);
    expect(rotationAt(-1, -100, true)).toBe(0);
  });
});

describe("croppedBy", () => {
  const none = { top: 0, right: 0, bottom: 0, left: 0 };
  const full = { width: 300, height: 150 };

  it("trims the side of the handle by the distance dragged inwards", () => {
    expect(croppedBy(none, "e", -100, 0, full)).toEqual({ ...none, right: 0.3333 });
    expect(croppedBy(none, "n", 0, 30, full)).toEqual({ ...none, top: 0.2 });
    expect(croppedBy(none, "sw", 60, -15, full)).toEqual({ ...none, left: 0.2, bottom: 0.1 });
  });

  it("gives back trimmed parts when dragged outwards, never beyond the image", () => {
    expect(croppedBy({ ...none, left: 0.2 }, "w", -30, 0, full)).toEqual({ ...none, left: 0.1 });
    expect(croppedBy({ ...none, left: 0.2 }, "w", -300, 0, full)).toEqual(none);
  });

  it("keeps part of the image visible", () => {
    const crop = croppedBy({ ...none, right: 0.5 }, "w", 1000, 0, full);
    expect(crop.left).toBeCloseTo(0.45, 4);
  });
});
