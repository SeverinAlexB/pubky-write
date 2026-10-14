// Headers, footers, page number fields and footnotes (Insert > Page elements). See
// docs/design/page-elements.md.
//
// Header and footer content is stored in attributes of the document node, as an array of block
// JSON (or null), and changed with a DocAttrStep like the page setup. Footnote text is an
// attribute of the footnote reference, an inline leaf node, changed with an AttrStep. Neither
// moves positions in the content, so comment anchors, search and the version diff are unaffected.
import { Extension, Node as TiptapNode, type JSONContent } from "@tiptap/core";
import type { Node, Schema } from "@tiptap/pm/model";

/** Block JSON of a header, footer or footnote. */
export type RegionContent = JSONContent[];

export const regionKeys = ["header", "footer", "firstPageHeader", "firstPageFooter"] as const;
export type RegionKey = (typeof regionKeys)[number];

/** Every document attribute this module adds. */
export const pageElementKeys = [...regionKeys, "differentFirstPage", "pageNumberStart"] as const;

export const MAX_PAGE_NUMBER_START = 9999;

/** Node types that may not appear in a header or footer. */
const notInHeaders = new Set(["pageBreak", "columnBreak", "footnote", "tableOfContents"]);
/** Footnote text is plain paragraphs. */
const footnoteBlocks = new Set(["paragraph"]);
const notInFootnotes = new Set(["footnote", "pageBreak", "columnBreak", "image", "tableOfContents"]);

let schemaForValidation: Schema | null = null;

/** Called by schema.ts once the schema exists, so attribute validation can parse region content. */
export function registerRegionSchema(schema: Schema): void {
  schemaForValidation = schema;
}

const validRegions = new WeakSet<object>();

/** Throws unless `value` is null or valid region content. */
function validateRegion(value: unknown, kind: "header" | "footnote"): void {
  if (value === null) return;
  if (!Array.isArray(value) || value.length === 0) throw new RangeError("Region content must be a non-empty array of blocks");
  if (validRegions.has(value)) return;
  const schema = schemaForValidation;
  if (!schema) throw new RangeError("The schema is not registered");
  const doc = schema.nodeFromJSON({ type: "doc", content: value });
  doc.check();
  const problem = regionProblem(doc, kind);
  if (problem) throw new RangeError(problem);
  validRegions.add(value);
}

/** Why a region's document is not allowed, or null when it is. */
export function regionProblem(doc: Node, kind: "header" | "footnote"): string | null {
  let problem: string | null = null;
  doc.forEach((block) => {
    if (kind === "footnote" && !footnoteBlocks.has(block.type.name)) problem = `A footnote cannot contain ${block.type.name}`;
  });
  const forbidden = kind === "footnote" ? notInFootnotes : notInHeaders;
  doc.descendants((node) => {
    if (forbidden.has(node.type.name)) problem = `A ${kind} cannot contain ${node.type.name}`;
    return problem === null;
  });
  return problem;
}

/** Adds the header and footer attributes to the document node. */
export const PageElementAttributes = Extension.create({
  name: "pageElementAttributes",

  addGlobalAttributes() {
    const region = { default: null, rendered: false, validate: (value: unknown) => validateRegion(value, "header") };
    return [
      {
        types: ["doc"],
        attributes: {
          header: region,
          footer: region,
          firstPageHeader: region,
          firstPageFooter: region,
          differentFirstPage: {
            default: false,
            rendered: false,
            validate: (value: unknown) => {
              if (typeof value !== "boolean") throw new RangeError("differentFirstPage must be a boolean");
            },
          },
          pageNumberStart: {
            default: 1,
            rendered: false,
            validate: (value: unknown) => {
              if (!isPageNumberStart(value)) throw new RangeError(`Invalid page number start ${String(value)}`);
            },
          },
        },
      },
    ];
  },
});

export function isPageNumberStart(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_PAGE_NUMBER_START;
}

export type PageElementSettings = {
  header: RegionContent | null;
  footer: RegionContent | null;
  firstPageHeader: RegionContent | null;
  firstPageFooter: RegionContent | null;
  differentFirstPage: boolean;
  pageNumberStart: number;
};

export function pageElementsOf(doc: Node): PageElementSettings {
  const region = (key: RegionKey) => (Array.isArray(doc.attrs[key]) ? (doc.attrs[key] as RegionContent) : null);
  return {
    header: region("header"),
    footer: region("footer"),
    firstPageHeader: region("firstPageHeader"),
    firstPageFooter: region("firstPageFooter"),
    differentFirstPage: doc.attrs.differentFirstPage === true,
    pageNumberStart: isPageNumberStart(doc.attrs.pageNumberStart) ? doc.attrs.pageNumberStart : 1,
  };
}

/** The attribute holding the header or footer of page `pageIndex` (0-based). */
export function regionKeyFor(kind: "header" | "footer", pageIndex: number, differentFirstPage: boolean): RegionKey {
  if (pageIndex === 0 && differentFirstPage) return kind === "header" ? "firstPageHeader" : "firstPageFooter";
  return kind;
}

/** The header or footer shown on page `pageIndex`, or null when it has none (or only empty paragraphs). */
export function regionFor(settings: PageElementSettings, kind: "header" | "footer", pageIndex: number): RegionContent | null {
  const content = settings[regionKeyFor(kind, pageIndex, settings.differentFirstPage)];
  return content && !isEmptyRegion(content) ? content : null;
}

/** Whether region content is nothing but empty paragraphs. */
export function isEmptyRegion(content: RegionContent | null | undefined): boolean {
  if (!content) return true;
  return content.every((block) => block.type === "paragraph" && !(block.content && block.content.length > 0));
}

export const emptyRegion = (): RegionContent => [{ type: "paragraph" }];

// ---------------------------------------------------------------------------------------------
// Page number and page count fields

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    pageField: {
      /** Inserts a page number ("page") or page count ("count") field at the cursor. */
      insertPageField: (kind: PageFieldKind) => ReturnType;
    };
  }
}

export type PageFieldKind = "page" | "count";

/**
 * A page number or page count. It has no text of its own: the editor draws the number with a
 * CSS counter, so find and word count never see it.
 */
export const PageField = TiptapNode.create({
  name: "pageField",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      kind: {
        default: "page",
        parseHTML: (element) => (element.getAttribute("data-field") === "count" ? "count" : "page"),
        renderHTML: ({ kind }) => ({ "data-field": kind }),
        validate: (value: unknown) => {
          if (value !== "page" && value !== "count") throw new RangeError(`Unknown page field ${String(value)}`);
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: "span.page-field[data-field]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", { ...HTMLAttributes, class: "page-field", contenteditable: "false" }];
  },

  renderText() {
    return "";
  },

  addCommands() {
    return {
      insertPageField:
        (kind) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { kind } }),
    };
  },
});

// ---------------------------------------------------------------------------------------------
// Footnotes

/**
 * A footnote reference. Its text is the `content` attribute (paragraph JSON); the editor shows
 * the reference as a superscript number and the text at the bottom of the reference's page.
 */
export const Footnote = TiptapNode.create({
  name: "footnote",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      content: {
        default: emptyRegion(),
        rendered: false,
        parseHTML: (element) => {
          try {
            const value = JSON.parse(element.getAttribute("data-content") ?? "null") as unknown;
            validateRegion(value, "footnote");
            return value ?? emptyRegion();
          } catch {
            return emptyRegion();
          }
        },
        validate: (value: unknown) => {
          if (value === null) throw new RangeError("A footnote needs content");
          validateRegion(value, "footnote");
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: "sup[data-footnote]" }];
  },

  renderHTML({ node }) {
    return ["sup", { class: "footnote-ref", "data-footnote": "", "data-content": JSON.stringify(node.attrs.content) }];
  },

  renderText() {
    return "";
  },
});

export type FootnoteRef = { pos: number; node: Node };

/** The footnote references in document order; footnote n (1-based) is entry n - 1. */
export function footnotesOf(doc: Node): FootnoteRef[] {
  const result: FootnoteRef[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "footnote") result.push({ pos, node });
    // Only text blocks and their containers can hold footnotes; skip leaf blocks and inline content quickly.
    return !node.isLeaf;
  });
  return result;
}

/** The plain text of region content, paragraphs separated by spaces. */
export function regionText(schema: Schema, content: RegionContent | null): string {
  if (!content) return "";
  const doc = schema.nodeFromJSON({ type: "doc", content });
  return doc.textBetween(0, doc.content.size, " ", "");
}
