import { documentSchema, pageElementsOf, regionText } from "@pubky-write/shared";
import { EditorState } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { addPageNumbers, currentPageNumberOptions } from "./pageElementCommands.ts";

const stateWith = (attrs: Record<string, unknown> = {}) =>
  EditorState.create({ doc: documentSchema.nodeFromJSON({ type: "doc", attrs, content: [{ type: "paragraph" }] }) });

function fields(content: unknown): string[] {
  const kinds: string[] = [];
  if (!content) return kinds;
  documentSchema.nodeFromJSON({ type: "doc", content }).descendants((node) => {
    if (node.type.name === "pageField") kinds.push(node.attrs.kind);
  });
  return kinds;
}

describe("page number presets", () => {
  it("adds a right-aligned page number to an empty footer on all pages", () => {
    const doc = addPageNumbers(stateWith(), { position: "footer", showOnFirstPage: true }).doc;
    const settings = pageElementsOf(doc);
    expect(fields(settings.footer)).toEqual(["page"]);
    expect(settings.footer![0]!.attrs!.textAlign).toBe("right");
    expect(settings.differentFirstPage).toBe(false);
    expect(settings.header).toBeNull();
  });

  it("keeps existing header text and adds the number after it, once", () => {
    const header = [{ type: "paragraph", content: [{ type: "text", text: "Report" }] }];
    const once = addPageNumbers(stateWith({ header }), { position: "header", showOnFirstPage: true }).doc;
    expect(regionText(documentSchema, pageElementsOf(once).header).trim()).toBe("Report");
    expect(fields(pageElementsOf(once).header)).toEqual(["page"]);
    const twice = addPageNumbers(EditorState.create({ doc: once }), { position: "header", showOnFirstPage: true }).doc;
    expect(fields(pageElementsOf(twice).header)).toEqual(["page"]);
  });

  it("skips the first page with a different first page, and sets the start", () => {
    const firstPageFooter = [{ type: "paragraph", content: [{ type: "text", text: "Cover " }, { type: "pageField", attrs: { kind: "page" } }] }];
    const doc = addPageNumbers(stateWith({ differentFirstPage: true, firstPageFooter }), {
      position: "footer",
      showOnFirstPage: false,
      start: 3,
    }).doc;
    const settings = pageElementsOf(doc);
    expect(settings.differentFirstPage).toBe(true);
    expect(fields(settings.firstPageFooter)).toEqual([]);
    expect(regionText(documentSchema, settings.firstPageFooter)).toBe("Cover ");
    expect(settings.pageNumberStart).toBe(3);
    expect(currentPageNumberOptions(doc)).toEqual({ position: "footer", showOnFirstPage: false, start: 3 });
  });

  it("shows the number on the first page's own footer too when asked", () => {
    const doc = addPageNumbers(stateWith({ differentFirstPage: true }), { position: "footer", showOnFirstPage: true }).doc;
    expect(fields(pageElementsOf(doc).firstPageFooter)).toEqual(["page"]);
    expect(currentPageNumberOptions(doc).showOnFirstPage).toBe(true);
  });
});
