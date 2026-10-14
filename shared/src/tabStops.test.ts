import { Node } from "@tiptap/pm/model";
import { Step } from "@tiptap/pm/transform";
import { describe, expect, it } from "vitest";
import { toMarkdown } from "./markdown.ts";
import { documentSchema } from "./schema.ts";
import { decodeTabStops, encodeTabStops, storedTabStops, tabAdvance, tabStopsOf, withTabNodes, type TabStop } from "./tabStops.ts";

const text = (value: string) => ({ type: "text", text: value });
const tab = { type: "tab" };
const stops: TabStop[] = [
  { pos: 170.08, kind: "left" },
  { pos: 250, kind: "center" },
  { pos: 396.85, kind: "right" },
];

describe("tabAdvance", () => {
  const base = { stops, indent: 0, following: 40, lineEnd: 450 };

  it("advances to the next stop: the text starts at a left stop, ends at a right stop, is centred on a centre stop", () => {
    expect(tabAdvance({ ...base, at: 30 })).toEqual({ width: 140.08, stop: stops[0] });
    expect(tabAdvance({ ...base, at: 200 })).toEqual({ width: 30, stop: stops[1] });
    expect(tabAdvance({ ...base, at: 300 }).width).toBeCloseTo(56.85, 6);
    expect(tabAdvance({ ...base, at: 300 }).stop).toEqual(stops[2]);
  });

  it("skips a stop the text has already reached", () => {
    expect(tabAdvance({ ...base, at: 170.08 }).stop).toEqual(stops[1]);
    expect(tabAdvance({ ...base, at: 175 }).stop).toEqual(stops[1]);
  });

  it("uses the half-inch default stops from the left indent without stops and after the last one", () => {
    expect(tabAdvance({ ...base, stops: [], at: 10 })).toEqual({ width: 26, stop: null });
    expect(tabAdvance({ ...base, stops: [], at: 36 })).toEqual({ width: 36, stop: null });
    expect(tabAdvance({ ...base, stops: [], indent: 20, at: 30 })).toEqual({ width: 26, stop: null });
    // A first line that starts before the indent goes to the indent.
    expect(tabAdvance({ ...base, stops: [], indent: 20, at: 5 })).toEqual({ width: 15, stop: null });
    expect(tabAdvance({ ...base, at: 400 })).toEqual({ width: 32, stop: null });
  });

  it("never goes past the end of the line, and starts text that does not fit before a stop where the tab is", () => {
    expect(tabAdvance({ ...base, at: 440, stops: [] }).width).toBe(10);
    expect(tabAdvance({ ...base, at: 380, following: 30 }).width).toBe(0);
    expect(tabAdvance({ ...base, at: 245, following: 30 }).width).toBe(0);
  });
});

describe("tab stop attribute", () => {
  it("stores stops rounded, sorted and one per position", () => {
    expect(storedTabStops([])).toBeNull();
    expect(
      storedTabStops([
        { pos: 300.004, kind: "right" },
        { pos: 100, kind: "left" },
        { pos: 300, kind: "center" },
        { pos: -5, kind: "left" },
      ]),
    ).toEqual([
      { pos: 0, kind: "left" },
      { pos: 100, kind: "left" },
      { pos: 300, kind: "center" },
    ]);
  });

  it("round-trips through the HTML attribute", () => {
    expect(encodeTabStops(stops)).toBe("l170.08 c250 r396.85");
    expect(decodeTabStops("l170.08 c250 r396.85")).toEqual(stops);
    expect(decodeTabStops("x12 l-3 r20")).toEqual([{ pos: 20, kind: "right" }]);
    expect(decodeTabStops(null)).toEqual([]);
  });

  it("loads documents saved before tab stops, and old steps still apply", () => {
    const old = Node.fromJSON(documentSchema, {
      type: "doc",
      content: [{ type: "paragraph", attrs: { textAlign: "left", indent: 1 }, content: [text("Old")] }],
    });
    old.check();
    expect(old.child(0).attrs.tabStops).toBeNull();
    expect(tabStopsOf(old.child(0).attrs)).toEqual([]);
    const step = Step.fromJSON(documentSchema, { stepType: "replace", from: 4, to: 4, slice: { content: [text("er")] } });
    expect(step.apply(old).doc!.textContent).toBe("Older");
  });

  it("accepts steps that set valid stops or add tabs, and rejects invalid ones", () => {
    const doc = Node.fromJSON(documentSchema, { type: "doc", content: [{ type: "paragraph", content: [text("AB")] }] });
    const set = (value: unknown) => Step.fromJSON(documentSchema, { stepType: "attr", pos: 0, attr: "tabStops", value }).apply(doc);
    const result = set(stops).doc!;
    expect(() => result.check()).not.toThrow();
    expect(result.child(0).attrs.tabStops).toEqual(stops);
    const reloaded = Node.fromJSON(documentSchema, JSON.parse(JSON.stringify(result.toJSON())));
    expect(reloaded.eq(result)).toBe(true);

    for (const invalid of [[], [{ pos: 10, kind: "decimal" }], [{ pos: "10", kind: "left" }], [stops[1], stops[0]], "l10"]) {
      expect(() => set(invalid).doc!.check()).toThrow();
    }

    const withTab = Step.fromJSON(documentSchema, { stepType: "replace", from: 2, to: 2, slice: { content: [tab] } }).apply(doc).doc!;
    expect(() => withTab.check()).not.toThrow();
    expect(withTab.textContent).toBe("A\tB");
    // Tabs are not allowed in code.
    const code = Node.fromJSON(documentSchema, { type: "doc", content: [{ type: "codeBlock", content: [text("x")] }] });
    const intoCode = Step.fromJSON(documentSchema, { stepType: "replace", from: 1, to: 1, slice: { content: [tab] } }).apply(code);
    expect(intoCode.failed).not.toBeNull();
  });

  it("splits tab characters in text into tab nodes, except in code", () => {
    const content = Node.fromJSON(documentSchema, {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "a\tb\t", marks: [{ type: "bold" }] }] },
        { type: "codeBlock", content: [text("x\ty")] },
      ],
    }).content;
    const result = withTabNodes(content, documentSchema.nodes.tab!);
    expect(result.child(0).content.toJSON()).toEqual([
      { type: "text", text: "a", marks: [{ type: "bold" }] },
      { type: "tab", marks: [{ type: "bold" }] },
      { type: "text", text: "b", marks: [{ type: "bold" }] },
      { type: "tab", marks: [{ type: "bold" }] },
    ]);
    expect(result.child(1).textContent).toBe("x\ty");
  });

  it("writes tabs to Markdown as tab characters, or a character reference at the start of a line", () => {
    const doc = Node.fromJSON(documentSchema, {
      type: "doc",
      content: [
        { type: "paragraph", content: [text("Name"), tab, text("Role")] },
        { type: "paragraph", content: [tab, text("Indented")] },
      ],
    });
    expect(toMarkdown(doc)).toBe("Name\tRole\n\n&#9;Indented\n");
  });
});
