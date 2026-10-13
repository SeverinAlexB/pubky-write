import { describe, expect, it } from "vitest";
import { formatCommentTime } from "../format.ts";
import { layoutCards } from "./commentLayout.ts";

const card = (key: string, anchorTop: number, height = 50) => ({ key, anchorTop, height });
const tops = (map: Map<string, number>) => Object.fromEntries(map);

describe("comment card layout", () => {
  it("puts cards at their anchors when they do not overlap", () => {
    expect(tops(layoutCards([card("a", 0), card("b", 300)], null))).toEqual({ a: 0, b: 300 });
  });

  it("pushes later cards down with an 8px gap", () => {
    expect(tops(layoutCards([card("a", 100), card("b", 100), card("c", 120)], null))).toEqual({ a: 100, b: 158, c: 216 });
  });

  it("keeps the active card at its anchor and moves the cards above it up", () => {
    const layout = layoutCards([card("a", 100), card("b", 100), card("c", 110)], "b");
    expect(tops(layout)).toEqual({ a: 42, b: 100, c: 158 });
  });

  it("leaves cards above the active one alone when there is room", () => {
    expect(tops(layoutCards([card("a", 0), card("b", 400)], "b"))).toEqual({ a: 0, b: 400 });
  });
});

describe("comment times", () => {
  const now = new Date(2026, 9, 13, 18, 0);

  it("shows the time with Today or Yesterday, and the date for older comments", () => {
    expect(formatCommentTime(new Date(2026, 9, 13, 16, 26).getTime(), now)).toMatch(/^16:26 Today$/);
    expect(formatCommentTime(new Date(2026, 9, 12, 9, 5).getTime(), now)).toMatch(/^09:05 Yesterday$/);
    expect(formatCommentTime(new Date(2026, 9, 1, 9, 5).getTime(), now)).toBe(
      new Date(2026, 9, 1).toLocaleDateString(undefined, { day: "numeric", month: "short" }),
    );
    expect(formatCommentTime(new Date(2025, 9, 1).getTime(), now)).toContain("2025");
  });
});
