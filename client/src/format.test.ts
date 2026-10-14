import { describe, expect, it } from "vitest";
import { dateGroup, formatListDate } from "./format.ts";

const now = new Date(2026, 9, 14, 9, 30);
const at = (month: number, day: number, hour = 12) => new Date(2026, month, day, hour).getTime();

describe("dateGroup", () => {
  it("groups by calendar days before today", () => {
    expect(dateGroup(at(9, 14, 0), now)).toBe("Today");
    expect(dateGroup(at(9, 13, 23), now)).toBe("Previous 7 days");
    expect(dateGroup(new Date(2026, 9, 7).getTime(), now)).toBe("Previous 7 days");
    expect(dateGroup(at(9, 6), now)).toBe("Previous 30 days");
    expect(dateGroup(new Date(2026, 8, 14).getTime(), now)).toBe("Previous 30 days");
    expect(dateGroup(at(8, 13), now)).toBe("Earlier");
  });
});

describe("formatListDate", () => {
  it("shows the time for today and the date with the year otherwise", () => {
    expect(formatListDate(at(9, 14, 6), now)).toMatch(/06|6/);
    expect(formatListDate(at(9, 14, 6), now)).not.toMatch(/2026/);
    expect(formatListDate(at(9, 7), now)).toMatch(/7.*2026|2026.*7/);
  });
});
