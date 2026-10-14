// Insert > Page elements > Table of contents. The table is one atomic block of entries built
// from the Title and Heading 1–6 paragraphs. It does not follow later edits: "Update table of
// contents" builds the entries again. Page numbers are stored on the entries and drawn by CSS,
// so they are not text that find or word count could see.
import { Node as TiptapNode, type JSONContent } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";

export const tocStyles = ["plain", "dotted", "links"] as const;
export type TocStyle = (typeof tocStyles)[number];

/** Shown when the document has no headings. */
export const TOC_PLACEHOLDER = "Add headings (Format > Paragraph styles) and they will appear in your table of contents.";

/** A heading the table of contents lists; level 0 is the Title. */
export type TocHeading = { level: number; text: string; pos: number };

/** The part of a document a table of contents lists: the content of its tab (see documentTabs.ts). */
export type TocRange = { from: number; to: number };

/** Title and Heading 1–6 blocks with text, in document order; only those in `range` when given. */
export function tocHeadings(doc: Node, range?: TocRange): TocHeading[] {
  const headings: TocHeading[] = [];
  doc.nodesBetween(range?.from ?? 0, range?.to ?? doc.content.size, (node, pos) => {
    if (node.type.name === "tableOfContents") return false;
    const level = node.type.name === "heading" ? (node.attrs.level as number) : node.attrs.paragraphStyle === "title" ? 0 : null;
    if (level !== null && node.isTextblock) {
      const text = node.textContent.trim();
      if (text) headings.push({ level, text, pos });
    }
    return node.isBlock && !node.isTextblock;
  });
  return headings;
}

/**
 * The entries of a table of contents for `doc`. Each level below the highest one present is
 * indented one step (0.5 in). `pageOf` gives the page number shown for a heading position.
 */
export function tocEntries(doc: Node, pageOf: (pos: number) => number | null = () => null, range?: TocRange): JSONContent[] {
  const headings = tocHeadings(doc, range);
  if (headings.length === 0) return [{ type: "tocEntry", content: [{ type: "text", text: TOC_PLACEHOLDER }] }];
  const top = Math.min(...headings.map((heading) => heading.level));
  return headings.map((heading, index) => ({
    type: "tocEntry",
    attrs: { indent: Math.min(heading.level - top, 6), page: pageOf(heading.pos), heading: index },
    content: [{ type: "text", text: heading.text }],
  }));
}

/** A table of contents node's JSON. */
export function tableOfContents(doc: Node, style: TocStyle, pageOf?: (pos: number) => number | null, range?: TocRange): JSONContent {
  return { type: "tableOfContents", attrs: { style }, content: tocEntries(doc, pageOf, range) };
}

/**
 * The heading an entry links to: the n-th heading with the entry's text (n counting the entries
 * before it with the same text), or the heading at the entry's index if the text changed.
 */
export function tocTarget(doc: Node, toc: Node, entryIndex: number, range?: TocRange): TocHeading | null {
  const entry = toc.maybeChild(entryIndex);
  if (!entry || entry.attrs.heading === null) return null;
  const headings = tocHeadings(doc, range);
  const text = entry.textContent.trim();
  let occurrence = 0;
  for (let index = 0; index < entryIndex; index++) if (toc.child(index).textContent.trim() === text) occurrence += 1;
  const sameText = headings.filter((heading) => heading.text === text);
  return sameText[occurrence] ?? sameText[0] ?? headings[entry.attrs.heading as number] ?? null;
}

/** An anchor name for a heading's text, as used by Markdown renderers ("My heading" → "my-heading"). */
export function headingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");
}

export const TableOfContents = TiptapNode.create({
  name: "tableOfContents",
  group: "block",
  content: "tocEntry+",
  atom: true,
  selectable: true,
  isolating: true,
  draggable: false,

  addAttributes() {
    return {
      style: {
        default: "plain",
        parseHTML: (element) => {
          const style = element.getAttribute("data-style");
          return tocStyles.includes(style as TocStyle) ? style : "plain";
        },
        renderHTML: ({ style }) => ({ "data-style": style }),
        validate: (value: unknown) => {
          if (!tocStyles.includes(value as TocStyle)) throw new RangeError(`Unknown table of contents style ${String(value)}`);
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="table-of-contents"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      { ...HTMLAttributes, "data-type": "table-of-contents", class: "toc", role: "navigation", "aria-label": "Table of contents" },
      0,
    ];
  },
});

export const TocEntry = TiptapNode.create({
  name: "tocEntry",
  content: "text*",
  marks: "",
  defining: true,

  addAttributes() {
    const integer = (name: string, max: number, nullable: boolean) => ({
      default: nullable ? null : 0,
      parseHTML: (element: HTMLElement) => {
        const value = Number.parseInt(element.getAttribute(`data-${name}`) ?? "", 10);
        return Number.isInteger(value) && value >= 0 && value <= max ? value : nullable ? null : 0;
      },
      renderHTML: (attrs: Record<string, unknown>) => (attrs[name] === null ? {} : { [`data-${name}`]: String(attrs[name]) }),
      validate: (value: unknown) => {
        if (nullable && value === null) return;
        if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max) {
          throw new RangeError(`Invalid table of contents ${name} ${String(value)}`);
        }
      },
    });
    return { indent: integer("indent", 6, false), page: integer("page", 99999, true), heading: integer("heading", 1_000_000, true) };
  },

  parseHTML() {
    return [{ tag: "div.toc-entry", contentElement: "span.toc-text" }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      { ...HTMLAttributes, class: "toc-entry", style: `padding-left: ${(node.attrs.indent as number) * 48}px` },
      ["span", { class: "toc-text" }, 0],
      ["span", { class: "toc-leader", contenteditable: "false", "aria-hidden": "true" }],
      ["span", { class: "toc-page", contenteditable: "false", "data-number": node.attrs.page === null ? "" : String(node.attrs.page) }],
    ];
  },
});
