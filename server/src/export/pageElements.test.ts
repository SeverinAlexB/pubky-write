// Headers, footers, page number fields, footnotes and tables of contents in the Word and
// Markdown exports, and back through the Word import.
import { documentSchema, footnotesOf, regionText, toMarkdown } from "@docs/shared";
import { Node } from "@tiptap/pm/model";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { docxToDocument } from "../import/docx.ts";
import { toDocx } from "./docx.ts";

const text = (value: string) => ({ type: "text", text: value });
const paragraph = (...content: unknown[]) => ({ type: "paragraph", content });
const footnote = (value: string) => ({ type: "footnote", attrs: { content: [paragraph(text(value))] } });
const field = (kind: "page" | "count") => ({ type: "pageField", attrs: { kind } });

const doc = Node.fromJSON(documentSchema, {
  type: "doc",
  attrs: {
    header: [paragraph(text("Quarterly report"))],
    footer: [{ type: "paragraph", attrs: { textAlign: "right" }, content: [text("Page "), field("page"), text(" of "), field("count")] }],
    firstPageHeader: [paragraph(text("Cover"))],
    differentFirstPage: true,
    pageNumberStart: 3,
  },
  content: [
    {
      type: "tableOfContents",
      attrs: { style: "dotted" },
      content: [
        { type: "tocEntry", attrs: { indent: 0, page: 3, heading: 0 }, content: [text("Introduction")] },
        { type: "tocEntry", attrs: { indent: 1, page: 4, heading: 1 }, content: [text("Details")] },
      ],
    },
    {
      type: "tableOfContents",
      attrs: { style: "links" },
      content: [
        { type: "tocEntry", attrs: { indent: 0, page: null, heading: 0 }, content: [text("Introduction")] },
        { type: "tocEntry", attrs: { indent: 1, page: null, heading: 1 }, content: [text("Details")] },
      ],
    },
    { type: "heading", attrs: { level: 1 }, content: [text("Introduction")] },
    paragraph(text("Sales grew"), footnote("Unaudited figures."), text(" and costs fell"), footnote("See appendix.")),
    { type: "heading", attrs: { level: 2 }, content: [text("Details")] },
    paragraph(text("There are "), field("count"), text(" pages.")),
  ],
});

async function parts(buffer: Buffer): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(buffer);
  const result: Record<string, string> = {};
  for (const name of Object.keys(zip.files)) if (name.endsWith(".xml")) result[name] = await zip.file(name)!.async("string");
  return result;
}

describe("Word export of page elements", () => {
  it("writes headers and footers, the first page's own, page fields and the page number start", async () => {
    const xml = await parts(await toDocx(doc, "Report", async () => null));
    const headers = Object.entries(xml).filter(([name]) => /^word\/header\d+\.xml$/.test(name)).map(([, part]) => part);
    const footers = Object.entries(xml).filter(([name]) => /^word\/footer\d+\.xml$/.test(name)).map(([, part]) => part);
    expect(headers.some((part) => part.includes("Quarterly report"))).toBe(true);
    expect(headers.some((part) => part.includes("Cover"))).toBe(true);
    // The first page has an empty footer of its own.
    expect(footers).toHaveLength(2);
    const footer = footers.find((part) => part.includes("Page "))!;
    expect(footer).toMatch(/PAGE/);
    expect(footer).toMatch(/NUMPAGES/);
    const body = xml["word/document.xml"]!;
    expect(body).toMatch(/<w:titlePg\s*\/>|<w:titlePg w:val="(true|1)"\/>/);
    expect(body).toMatch(/<w:pgNumType w:start="3"/);
    expect(body).toMatch(/w:headerReference w:type="first"/);
  });

  it("writes real footnotes", async () => {
    const xml = await parts(await toDocx(doc, "Report", async () => null));
    const footnotes = xml["word/footnotes.xml"]!;
    expect(footnotes).toContain("Unaudited figures.");
    expect(footnotes).toContain("See appendix.");
    expect(xml["word/document.xml"]!.match(/<w:footnoteReference /g)).toHaveLength(2);
  });

  it("writes tables of contents as paragraphs with a right tab, a dotted leader or links to the headings", async () => {
    const body = (await parts(await toDocx(doc, "Report", async () => null)))["word/document.xml"]!;
    expect(body).toMatch(/<w:tab w:val="right" w:pos="\d+" w:leader="dot"\/>|<w:tab w:val="right" w:leader="dot" w:pos="\d+"\/>/);
    expect(body).toMatch(/<w:hyperlink [^>]*w:anchor="_Toc0"/);
    expect(body).toMatch(/<w:bookmarkStart [^>]*w:name="_Toc0"/);
    expect(body).toMatch(/<w:bookmarkStart [^>]*_Toc1/);
  });
});

describe("Word import of page elements", () => {
  it("reads back headers, footers, page fields, the first page settings and footnotes", async () => {
    const { doc: imported, dropped } = await docxToDocument(await toDocx(doc, "Report", async () => null), {
      storeImage: async () => null,
    });
    expect(dropped).toEqual([]);
    expect(regionText(documentSchema, imported.attrs.header)).toBe("Quarterly report");
    expect(regionText(documentSchema, imported.attrs.firstPageHeader)).toBe("Cover");
    expect(imported.attrs.differentFirstPage).toBe(true);
    expect(imported.attrs.pageNumberStart).toBe(3);
    const footer = documentSchema.nodeFromJSON({ type: "doc", content: imported.attrs.footer });
    const fields: string[] = [];
    footer.descendants((node) => {
      if (node.type.name === "pageField") fields.push(node.attrs.kind);
    });
    expect(fields).toEqual(["page", "count"]);
    expect(footer.textContent).toBe("Page  of ");
    expect(footer.firstChild!.attrs.textAlign).toBe("right");
    expect(footnotesOf(imported).map((note) => regionText(documentSchema, note.node.attrs.content))).toEqual([
      "Unaudited figures.",
      "See appendix.",
    ]);
  });
});

describe("Markdown export of page elements", () => {
  it("writes footnotes as [^n], a table of contents as links and leaves headers and footers out", () => {
    const markdown = toMarkdown(doc);
    expect(markdown).toContain("Sales grew[^1] and costs fell[^2]");
    expect(markdown).toContain("[^1]: Unaudited figures.\n[^2]: See appendix.\n");
    expect(markdown).toContain("- [Introduction](#introduction)\n  - [Details](#details)");
    expect(markdown).not.toContain("Quarterly report");
    expect(markdown).toContain("There are  pages.");
  });
});
