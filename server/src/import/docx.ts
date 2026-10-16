// Converts a Word file (.docx) into a document. It reads the main document part with its styles,
// numbering and relationships:
//
// - Paragraph styles by name: Title, Subtitle and Heading 1–9 (7–9 become Heading 6), or an
//   outline level; alignment, line spacing, space before and after, and indentation.
// - Bold, italic, underline, strikethrough, superscript, subscript, text colour, highlight,
//   font size and font; links (hyperlink elements and HYPERLINK fields).
// - Bulleted and numbered lists from Word numbering, with the closest list preset; paragraphs
//   starting with ☐ or ☑ (as the Word export writes checklists) become checklists.
// - Tables with merged cells, images (PNG, JPEG, GIF, WebP), line and page breaks, and the page
//   size, orientation and margins.
// - The default and first-page header and footer of the last section ("different first page"),
//   the page number start, PAGE and NUMPAGES fields, footnotes, and endnotes as footnotes.
// - Comments with their range (or the word at their reference mark), replies and resolved state.
// - Equations (Office Math) as equations (see ../omml.ts).
//
// What the editor cannot show keeps its text: text in text boxes and shapes follows its
// paragraph, tables nested more than five deep become their paragraphs, embedded objects show their preview picture. Even-page headers, charts, shapes
// without text and pictures in other formats are dropped. All of these are reported. Rows of
// different lengths are filled up to rectangles. Tracked changes in the body, headers, footers and footnotes become
// suggestions: insertions (w:ins, w:moveTo), deletions (w:del, w:moveFrom), run format changes
// (w:rPrChange), inserted or deleted paragraph marks (suggested paragraph breaks), inserted or
// deleted table rows (w:trPr) and cells (w:cellIns, w:cellDel), and images, breaks and footnote
// references inside w:ins or w:del.
import {
  bulletPresets,
  documentSchema,
  sameJSON,
  indentAttributes,
  isColumnSpacing,
  isImageCrop,
  isMargin,
  isPageColor,
  isPageNumberStart,
  MAX_EQUATION_LENGTH,
  MAX_COLUMNS,
  MAX_IMAGE_MARGIN_PT,
  normalizeRotation,
  numberedPresets,
  paperSizes,
  paragraphStyleDefinitions,
  regionProblem,
  storedTabStops,
  type ParagraphStyleId,
  type RegionContent,
} from "@pubky-write/shared";
import type { JSONContent } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { Transform } from "@tiptap/pm/transform";
import type { TabStopKind } from "@pubky-write/shared";
import { toLatex } from "@pubky-write/shared/equations";
import JSZip from "jszip";
import { xml2js } from "xml-js";
import { ommlToMath } from "../omml.ts";
import {
  DroppedContent,
  emptyParagraph,
  finishDocument,
  ImportError,
  leafNode,
  repair,
  textNode,
  withRectangularTables,
  type ImageStore,
  type ImportedComment,
  type ImportOptions,
  type ImportResult,
  type MarkJSON,
} from "./content.ts";

type XmlNode = {
  type: string;
  name?: string;
  attributes?: Record<string, string | number | undefined>;
  elements?: XmlNode[];
  text?: string | number | boolean;
};

/** An element with namespace prefixes removed from its own and its attributes' names. */
type Element = { name: string; attributes: Record<string, string>; children: Element[]; text: string };

const TWIPS_PER_POINT = 20;
const TWIPS_PER_INDENT = 720;
const EMU_PER_PX = 9525;
const MAX_INDENT = 8;
/** Tables inside tables up to this depth are kept as tables. */
const MAX_TABLE_DEPTH = 5;
/** Word files are zip archives; a larger main part is very likely not a real document. */
const MAX_PART_BYTES = 100 * 1024 * 1024;

const highlightColors: Record<string, string> = {
  yellow: "#ffff00",
  green: "#00ff00",
  cyan: "#00ffff",
  magenta: "#ff00ff",
  blue: "#0000ff",
  red: "#ff0000",
  darkBlue: "#000080",
  darkCyan: "#008080",
  darkGreen: "#008000",
  darkMagenta: "#800080",
  darkRed: "#800000",
  darkYellow: "#808000",
  darkGray: "#808080",
  lightGray: "#c0c0c0",
  black: "#000000",
  white: "#ffffff",
};

const alignments: Record<string, string> = { center: "center", right: "right", end: "right", both: "justify", distribute: "justify" };

const numberedPresetByFormat: Record<string, string> = {
  upperLetter: "upper-alpha",
  upperRoman: "upper-roman",
  decimalZero: "zero-padded",
};

export async function docxToDocument(data: Uint8Array, options: ImportOptions): Promise<ImportResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new ImportError("The file is not a Word document");
  }
  const documentPath = (await mainDocumentPath(zip)) ?? "word/document.xml";
  const document = await readPart(zip, documentPath);
  if (!document) throw new ImportError("The file is not a Word document");
  const directory = documentPath.slice(0, documentPath.lastIndexOf("/") + 1);
  const relsPath = `${directory}_rels/${documentPath.slice(directory.length)}.rels`;

  const rels = parseRelationships(await readPart(zip, relsPath));
  const parts: Parts = {
    zip,
    directory,
    styles: parseStyles(await readPart(zip, `${directory}styles.xml`)),
    numbering: parseNumbering(await readPart(zip, `${directory}numbering.xml`)),
    storeImage: options.storeImage,
    dropped: new DroppedContent(),
    footnotes: new Map(),
    endnotes: new Map(),
    margins: { left: 96, top: 96 },
  };
  for (const kind of ["footnote", "endnote"] as const) {
    const notesRel = [...rels.values()].find((rel) => rel.type.endsWith(`/${kind}s`) && !rel.external);
    if (!notesRel) continue;
    const path = resolvePath(directory, notesRel.target);
    const notesPart = await readPart(zip, path);
    const notesRels = parseRelationships(await readPart(zip, relationshipsPath(path)));
    for (const note of find(notesPart, `${kind}s`)?.children ?? []) {
      // Separators and continuation notices have a type; real notes have none.
      if (note.name === kind && !note.attributes.type && note.attributes.id) {
        parts[`${kind}s`].set(note.attributes.id, { element: note, rels: notesRels });
      }
    }
  }
  // Some writers split the body into several (Word reads them one after the other).
  const bodies = (child(document, "document")?.children ?? []).filter((candidate) => candidate.name === "body");
  if (bodies.length === 0) throw new ImportError("The Word document has no body");
  const body: Element = { name: "body", attributes: {}, text: "", children: bodies.flatMap((candidate) => candidate.children) };
  const section = body.children.findLast((child) => child.name === "sectPr");
  const setup = section ? pageSetup(section) : {};
  parts.margins = {
    left: ((typeof setup.marginLeft === "number" ? setup.marginLeft : 72) * 96) / 72,
    top: ((typeof setup.marginTop === "number" ? setup.marginTop : 72) * 96) / 72,
  };
  const converter = new DocxConverter(parts, rels);
  const blocks = await converter.blocks(body.children);
  // Ranges that end after the last paragraph end with it.
  if (converter.pendingMarkers.length > 0) appendToLastTextblock(blocks, converter.pendingMarkers);
  const attrs = section ? { ...setup, ...columnSettings(section), ...(await headersAndFooters(section, rels, parts)) } : {};
  // The page colour (w:background, shown by Word with w:displayBackgroundShape).
  const background = val(child(child(document, "document"), "background"), "color")?.toLowerCase();
  if (background && isPageColor(`#${background}`) && background !== "ffffff") attrs.pageColor = `#${background}`;
  const { doc, ranges } = commentRanges(finishDocument(blocks, options, attrs));
  const commentsRel = [...rels.values()].find((rel) => rel.type.endsWith("/comments") && !rel.external);
  const extendedRel = [...rels.values()].find((rel) => rel.type.endsWith("/commentsExtended") && !rel.external);
  const comments = commentsRel
    ? commentThreads(
        doc,
        await readPart(zip, resolvePath(directory, commentsRel.target)),
        extendedRel ? await readPart(zip, resolvePath(directory, extendedRel.target)) : null,
        ranges,
        parts.dropped,
      )
    : [];
  return { doc, dropped: parts.dropped.list(), comments };
}

/** What every converter of a file shares: the zip, styles, numbering and footnotes. */
type Parts = {
  zip: JSZip;
  directory: string;
  styles: Styles;
  numbering: Numbering;
  storeImage: ImageStore;
  dropped: DroppedContent;
  footnotes: Map<string, { element: Element; rels: Map<string, Relationship> }>;
  /** Endnotes, which become footnotes (the editor has no endnotes). */
  endnotes: Map<string, { element: Element; rels: Map<string, Relationship> }>;
  /** The page's left and top margin in CSS pixels, for images positioned from the page's margins. */
  margins: { left: number; top: number };
};

function relationshipsPath(partPath: string): string {
  const slash = partPath.lastIndexOf("/");
  return `${partPath.slice(0, slash + 1)}_rels/${partPath.slice(slash + 1)}.rels`;
}

/** The default and first-page header and footer of a section, the different first page and the page number start. */
async function headersAndFooters(section: Element, rels: Map<string, Relationship>, parts: Parts): Promise<Record<string, unknown>> {
  const attrs: Record<string, unknown> = {};
  const differentFirstPage = toggle(child(section, "titlePg")) === true;
  if (differentFirstPage) attrs.differentFirstPage = true;
  const start = number(val(child(section, "pgNumType"), "start"));
  if (isPageNumberStart(start)) attrs.pageNumberStart = start;

  for (const reference of section.children) {
    const kind = reference.name === "headerReference" ? "header" : reference.name === "footerReference" ? "footer" : null;
    if (!kind) continue;
    const type = reference.attributes.type ?? "default";
    if (type === "even") {
      parts.dropped.add("Even page headers and footers");
      continue;
    }
    if (type === "first" && !differentFirstPage) continue;
    const rel = reference.attributes.id ? rels.get(reference.attributes.id) : undefined;
    if (!rel || rel.external) continue;
    const path = resolvePath(parts.directory, rel.target);
    const part = await readPart(parts.zip, path);
    const root = find(part, kind === "header" ? "hdr" : "ftr");
    if (!root) continue;
    const converter = new DocxConverter(parts, parseRelationships(await readPart(parts.zip, relationshipsPath(path))), "header");
    const content = regionContent(await converter.blocks(root.children), "header");
    if (!content) continue;
    const key = type === "first" ? (kind === "header" ? "firstPageHeader" : "firstPageFooter") : kind;
    attrs[key] = content;
  }
  return attrs;
}

/**
 * Header, footer or footnote content the editor allows: no page breaks or footnotes in headers,
 * only paragraphs (with text) in footnotes. Null when nothing is left or it is still invalid.
 */
function regionContent(blocks: JSONContent[], kind: "header" | "footnote"): RegionContent | null {
  const withoutNotes = (node: JSONContent): JSONContent => ({
    ...node,
    ...(node.content && { content: node.content.filter((inline) => inline.type !== "footnote" && inline.type !== "image").map(withoutNotes) }),
  });
  let result = blocks.filter((block) => block.type !== "pageBreak").map(withoutNotes);
  if (kind === "footnote") result = result.flatMap(paragraphsOf);
  if (result.length === 0 || result.every((block) => block.type === "paragraph" && !block.content?.length)) return null;
  try {
    const doc = withRectangularTables(documentSchema.nodeFromJSON({ type: "doc", content: result.map(repair) }));
    doc.check();
    if (regionProblem(doc, kind)) return null;
    return doc.content.toJSON() as RegionContent;
  } catch {
    return null;
  }
}

/** The paragraphs of a block: headings become paragraphs, lists and tables are flattened. */
function paragraphsOf(block: JSONContent): JSONContent[] {
  if (block.type === "paragraph") return [{ type: "paragraph", ...(block.content && { content: block.content }) }];
  if (block.type === "heading") return [{ type: "paragraph", ...(block.content && { content: block.content }) }];
  return (block.content ?? []).flatMap(paragraphsOf);
}

// ---------------------------------------------------------------------------------------------
// Parts

async function mainDocumentPath(zip: JSZip): Promise<string | null> {
  const rels = parseRelationships(await readPart(zip, "_rels/.rels"));
  const main = [...rels.values()].find((rel) => rel.type.endsWith("/officeDocument"));
  return main ? main.target.replace(/^\//, "") : null;
}

async function readPart(zip: JSZip, path: string): Promise<Element | null> {
  const file = zip.file(path);
  if (!file) return null;
  const xml = await file.async("string");
  if (xml.length > MAX_PART_BYTES) throw new ImportError("The Word document is too large");
  try {
    const root = xml2js(xml, { compact: false, captureSpacesBetweenElements: true }) as XmlNode;
    return toElement({ type: "element", name: "#root", elements: root.elements ?? [] });
  } catch {
    throw new ImportError("The Word document could not be read");
  }
}

const localName = (name: string) => name.slice(name.indexOf(":") + 1);

/** Without recursion: fuzzed and machine-made files nest elements tens of thousands deep. */
function toElement(root: XmlNode): Element {
  const convert = (node: XmlNode): Element => {
    const attributes: Record<string, string> = {};
    for (const [name, value] of Object.entries(node.attributes ?? {})) {
      if (value !== undefined) attributes[localName(name)] = String(value);
    }
    return { name: localName(node.name ?? ""), attributes, children: [], text: "" };
  };
  const result = convert(root);
  const stack: [XmlNode, Element][] = [[root, result]];
  while (stack.length > 0) {
    const [node, element] = stack.pop()!;
    for (const child of node.elements ?? []) {
      if (child.type === "element") {
        const converted = convert(child);
        element.children.push(converted);
        stack.push([child, converted]);
      } else if (child.type === "text" || child.type === "cdata") {
        element.text += String(child.text ?? (child as { cdata?: string }).cdata ?? "");
      }
    }
  }
  return result;
}

function child(element: Element | undefined, name: string): Element | undefined {
  return element?.children.find((candidate) => candidate.name === name);
}

/** The first descendant named `name`, depth first. */
function find(element: Element | undefined | null, name: string): Element | undefined {
  if (!element) return undefined;
  const stack = [...element.children].reverse();
  while (stack.length > 0) {
    const candidate = stack.pop()!;
    if (candidate.name === name) return candidate;
    for (let index = candidate.children.length - 1; index >= 0; index--) stack.push(candidate.children[index]!);
  }
  return undefined;
}

/** The descendants named `name`, in document order, not looking inside the ones found. */
function findAll(element: Element, name: string): Element[] {
  const result: Element[] = [];
  const stack = [...element.children].reverse();
  while (stack.length > 0) {
    const candidate = stack.pop()!;
    if (candidate.name === name) result.push(candidate);
    else for (let index = candidate.children.length - 1; index >= 0; index--) stack.push(candidate.children[index]!);
  }
  return result;
}

function val(element: Element | undefined, attribute = "val"): string | undefined {
  return element?.attributes[attribute];
}

/** An on/off property such as `<w:b/>`, `<w:b w:val="0"/>`; undefined when absent. */
function toggle(element: Element | undefined): boolean | undefined {
  if (!element) return undefined;
  const value = val(element);
  return value === undefined || !["0", "false", "off", "none"].includes(value);
}

function number(value: string | undefined): number | undefined {
  const result = value === undefined ? NaN : Number(value);
  return Number.isFinite(result) ? result : undefined;
}

type Relationship = { type: string; target: string; external: boolean };

function parseRelationships(part: Element | null): Map<string, Relationship> {
  const result = new Map<string, Relationship>();
  for (const rel of find(part, "Relationships")?.children ?? []) {
    const id = rel.attributes.Id;
    if (id) {
      result.set(id, { type: rel.attributes.Type ?? "", target: rel.attributes.Target ?? "", external: rel.attributes.TargetMode === "External" });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// Styles

type Style = { name: string; basedOn?: string; outlineLevel?: number; numbering?: Element; runProperties?: Element };
type Styles = Map<string, Style>;

function parseStyles(part: Element | null): Styles {
  const styles: Styles = new Map();
  for (const style of find(part, "styles")?.children ?? []) {
    const id = style.attributes.styleId;
    if (style.name !== "style" || !id) continue;
    const paragraphProperties = child(style, "pPr");
    styles.set(id, {
      name: (val(child(style, "name")) ?? id).toLowerCase(),
      basedOn: val(child(style, "basedOn")),
      outlineLevel: number(val(child(paragraphProperties, "outlineLvl"))),
      numbering: child(paragraphProperties, "numPr"),
      runProperties: child(style, "rPr"),
    });
  }
  return styles;
}

/** A style and the styles it is based on, nearest first. */
function styleChain(styles: Styles, id: string | undefined): Style[] {
  const chain: Style[] = [];
  for (let current = id; current && chain.length < 20; ) {
    const style = styles.get(current);
    if (!style) break;
    chain.push(style);
    current = style.basedOn;
  }
  return chain;
}

function paragraphStyleId(styles: Styles, id: string | undefined): ParagraphStyleId {
  for (const style of styleChain(styles, id)) {
    if (style.name === "title") return "title";
    if (style.name === "subtitle") return "subtitle";
    const heading = style.name.match(/^heading ([1-9])$/);
    if (heading) return `h${Math.min(Number(heading[1]), 6)}` as ParagraphStyleId;
    if (style.outlineLevel !== undefined && style.outlineLevel < 9) return `h${Math.min(style.outlineLevel + 1, 6)}` as ParagraphStyleId;
  }
  return "normal";
}

// ---------------------------------------------------------------------------------------------
// Numbering

type Level = { format: string; text: string; start: number };
type Numbering = { levels: Map<string, Level[]>; instances: Map<string, { abstractId: string; startOverrides: Map<number, number> }> };

function parseNumbering(part: Element | null): Numbering {
  const levels = new Map<string, Level[]>();
  const instances: Numbering["instances"] = new Map();
  for (const element of find(part, "numbering")?.children ?? []) {
    if (element.name === "abstractNum") {
      const list: Level[] = [];
      for (const level of element.children.filter((candidate) => candidate.name === "lvl")) {
        list[number(level.attributes.ilvl) ?? list.length] = {
          format: val(child(level, "numFmt")) ?? "decimal",
          text: val(child(level, "lvlText")) ?? "",
          start: number(val(child(level, "start"))) ?? 1,
        };
      }
      levels.set(element.attributes.abstractNumId ?? "", list);
    } else if (element.name === "num") {
      const startOverrides = new Map<number, number>();
      for (const override of element.children.filter((candidate) => candidate.name === "lvlOverride")) {
        const start = number(val(child(override, "startOverride")));
        if (start !== undefined) startOverrides.set(number(override.attributes.ilvl) ?? 0, start);
      }
      instances.set(element.attributes.numId ?? "", { abstractId: val(child(element, "abstractNumId")) ?? "", startOverrides });
    }
  }
  return { levels, instances };
}

type ListInfo = { type: "bulletList" | "orderedList" | "taskList"; key: string; preset: string | 0; start: number };

// ---------------------------------------------------------------------------------------------
// Conversion

/** A converted top-level piece: an ordinary block, or a list item still to be grouped into lists. */
type Entry = { kind: "block"; node: JSONContent } | { kind: "item"; list: ListInfo; level: number; checked?: boolean; blocks: JSONContent[] };

type Field = { instruction: string; result: boolean; link?: string; pageField?: "page" | "count"; emitted?: boolean };

type InlineContext = { marks: MarkJSON[]; link?: string; inHyperlink: boolean; deleted?: boolean };

class DocxConverter {
  private readonly fields: Field[] = [];
  /** A suggested paragraph break after the previous paragraph (its paragraph mark was inserted or deleted). */
  private pendingBreak: Record<string, unknown> | null = null;
  /**
   * The last revision read, until other content follows. Adjacent revisions by the same author at
   * the same time (a deletion and its replacement, an inserted paragraph mark and the text after
   * it, runs with different formatting) are one suggestion.
   */
  private lastRevision: { key: string; id: string } | null = null;
  /** How many items each numbered list (by numbering instance and level) has had, so interrupted lists continue. */
  private readonly listCounts = new Map<string, number>();
  private readonly zip: JSZip;
  private readonly directory: string;
  private readonly styles: Styles;
  private readonly numbering: Numbering;
  private readonly storeImage: ImageStore;
  readonly dropped: DroppedContent;

  /** `part` is the kind of part converted: the body, a header or footer, or a footnote. */
  constructor(
    private readonly parts: Parts,
    private readonly rels: Map<string, Relationship>,
    private readonly part: "body" | "header" | "footnote" = "body",
  ) {
    ({ zip: this.zip, directory: this.directory, styles: this.styles, numbering: this.numbering, storeImage: this.storeImage, dropped: this.dropped } =
      parts);
  }

  /** Converts body or table cell content to blocks, grouping list paragraphs into lists. */
  async blocks(elements: Element[]): Promise<JSONContent[]> {
    const entries: Entry[] = [];
    for (const element of elements) entries.push(...(await this.element(element)));
    return this.groupLists(entries);
  }

  private async element(element: Element): Promise<Entry[]> {
    switch (element.name) {
      case "p":
        return this.paragraph(element);
      case "tbl": {
        this.pendingBreak = null;
        if (this.tableDepth >= MAX_TABLE_DEPTH) return this.flattenedTable(element);
        this.tableDepth++;
        try {
          const table = await this.table(element);
          return table ? [{ kind: "block", node: table }] : [];
        } finally {
          this.tableDepth--;
        }
      }
      case "sdt":
      case "customXml":
      case "ins":
      case "moveTo": {
        const content = element.name === "sdt" ? child(element, "sdtContent") : element;
        const entries: Entry[] = [];
        for (const nested of content?.children ?? []) entries.push(...(await this.element(nested)));
        return entries;
      }
      case "AlternateContent":
        return this.element(child(element, "Choice") ?? child(element, "Fallback") ?? element);
      case "commentRangeStart":
      case "commentRangeEnd":
        // Between paragraphs: the range starts or ends at the start of the next paragraph.
        this.pendingMarkers.push(...this.commentMarker(element));
        return [];
      default:
        return [];
    }
  }

  // Paragraphs ---------------------------------------------------------------------------------

  /** Comment range markers met between paragraphs, for the start of the next one. */
  pendingMarkers: JSONContent[] = [];

  /** Marks where a comment's range starts or ends (see commentRanges); comments only belong to the body. */
  private commentMarker(element: Element): JSONContent[] {
    const id = element.attributes.id;
    if (id === undefined) return [];
    if (this.part !== "body") {
      this.dropped.add("Comments on headers, footers and footnotes");
      return [];
    }
    return textNode(commentMarker(element.name === "commentRangeStart" ? "start" : "end", id), []);
  }

  /** The text of text boxes and shapes in the paragraph being converted, as paragraphs to follow it. */
  private boxBlocks: JSONContent[] = [];

  private async paragraph(element: Element): Promise<Entry[]> {
    const outer = this.boxBlocks;
    this.boxBlocks = [];
    try {
      const entries = await this.paragraphEntries(element);
      return [...entries, ...this.boxBlocks.map((node) => ({ kind: "block" as const, node }))];
    } finally {
      this.boxBlocks = outer;
    }
  }

  private async paragraphEntries(element: Element): Promise<Entry[]> {
    const properties = child(element, "pPr");
    const styleId = val(child(properties, "pStyle"));
    const style = paragraphStyleId(this.styles, styleId);
    const inline = [...this.pendingMarkers.splice(0), ...(await this.inlineContent(element.children, { marks: [], inHyperlink: false }, style))];

    const list = style.startsWith("h") ? null : this.listOf(properties, styleId);
    const level = list ? (number(val(child(child(properties, "numPr") ?? this.styleNumbering(styleId), "ilvl"))) ?? 0) : 0;
    const attrs = paragraphAttributes(properties, style, list !== null);
    const previousBreak = this.pendingBreak;
    if (this.pendingBreak) attrs.suggestionBreak = this.pendingBreak;
    this.pendingBreak = this.paragraphMarkRevision(properties);
    const textBlock: JSONContent = style.startsWith("h")
      ? { type: "heading", attrs: { ...attrs, level: Number(style.slice(1)) } }
      : { type: "paragraph", attrs: { ...attrs, ...(style !== "normal" && { paragraphStyle: style }) } };

    const blocks = splitParagraph(textBlock, inline);
    // A paragraph of nothing but an inserted or deleted image or break (as the export writes them):
    // its paragraph mark belongs to the object, not to the text around it.
    if (blocks.length > 0 && blocks.every((block) => block.attrs?.suggestionInsert || block.attrs?.suggestionDelete)) {
      this.pendingBreak = previousBreak;
    }
    const pageBreakBefore = toggle(child(properties, "pageBreakBefore")) ? [{ kind: "block" as const, node: { type: "pageBreak" } }] : [];

    if (list) return [...pageBreakBefore, { kind: "item", list, level: Math.min(level, MAX_INDENT), blocks }];

    const task = taskMarker(blocks[0]);
    if (task) {
      const indent = number(val(child(properties, "ind"), "left") ?? val(child(properties, "ind"), "start")) ?? TWIPS_PER_INDENT;
      const taskList: ListInfo = { type: "taskList", key: "task", preset: 0, start: 1 };
      const level = Math.max(0, Math.min(MAX_INDENT, Math.round(indent / TWIPS_PER_INDENT) - 1));
      const { indentLeft: _left, indentFirstLine: _firstLine, indentRight: _right, ...attrs } = task.paragraph.attrs ?? {};
      const first = { ...task.paragraph, attrs };
      return [...pageBreakBefore, { kind: "item", list: taskList, level, checked: task.checked, blocks: [first, ...blocks.slice(1)] }];
    }
    return [...pageBreakBefore, ...blocks.map((node) => ({ kind: "block" as const, node }))];
  }

  private styleNumbering(styleId: string | undefined): Element | undefined {
    return styleChain(this.styles, styleId).find((style) => style.numbering)?.numbering;
  }

  /** The list a paragraph belongs to, from its own numbering or its style's. */
  private listOf(properties: Element | undefined, styleId: string | undefined): ListInfo | null {
    const own = child(properties, "numPr");
    const numId = val(child(own, "numId")) ?? val(child(this.styleNumbering(styleId), "numId"));
    if (!numId || numId === "0") return null;
    const instance = this.numbering.instances.get(numId);
    const levels = instance ? this.numbering.levels.get(instance.abstractId) : undefined;
    const ilvl = number(val(child(own ?? this.styleNumbering(styleId), "ilvl"))) ?? 0;
    const level = levels?.[ilvl] ?? levels?.[0];
    if (level?.format === "none") return null;
    const start = instance?.startOverrides.get(ilvl) ?? level?.start ?? 1;
    if (!level || level.format === "bullet") {
      const glyphs = [levels?.[0]?.text, levels?.[1]?.text];
      const preset = bulletPresets.findIndex((candidate) => candidate.glyphs[0] === glyphs[0] && candidate.glyphs[1] === glyphs[1]);
      return { type: "bulletList", key: `bullet-${numId}`, preset: preset > 0 ? bulletPresets[preset]!.id : 0, start: 1 };
    }
    const first = levels?.[0] ?? level;
    let preset: string | undefined = numberedPresetByFormat[first.format];
    if (!preset && first.format === "decimal") {
      if (first.text.endsWith(")")) preset = "decimal-parenthesis";
      else if (levels?.[1]?.text === "%1.%2.") preset = "outline";
    }
    const index = numberedPresets.findIndex((candidate) => candidate.id === preset);
    return { type: "orderedList", key: `ordered-${numId}`, preset: index > 0 ? numberedPresets[index]!.id : 0, start };
  }

  /** Inline content of a paragraph (or of an element inside one): text, breaks and images. */
  private async inlineContent(elements: Element[], context: InlineContext, style: ParagraphStyleId): Promise<JSONContent[]> {
    const result: JSONContent[] = [];
    for (const element of elements) {
      switch (element.name) {
        case "r":
          result.push(...(await this.run(element, context, style)));
          break;
        case "hyperlink": {
          const rel = element.attributes.id ? this.rels.get(element.attributes.id) : undefined;
          const link = rel?.external ? rel.target : undefined;
          // Table of contents entries (anchors "_Toc…") keep their text; other links within the document are reported.
          if (!link && element.attributes.anchor && !element.attributes.anchor.startsWith("_Toc")) {
            this.dropped.add("Links to places in the document");
          }
          result.push(...(await this.inlineContent(element.children, { ...context, link: link ?? context.link, inHyperlink: true }, style)));
          break;
        }
        case "fldSimple": {
          const pageField = pageFieldKind(element.attributes.instr ?? "");
          if (pageField) {
            result.push({ type: "pageField", attrs: { kind: pageField } });
            break;
          }
          const link = hyperlinkField(element.attributes.instr ?? "");
          result.push(...(await this.inlineContent(element.children, { ...context, link: link ?? context.link }, style)));
          break;
        }
        case "ins":
        case "moveTo": {
          const mark = this.revisionMark("suggestionInsert", element);
          const inserted = mark ? { ...context, marks: [...context.marks, mark] } : context;
          result.push(...(await this.inlineContent(element.children, inserted, style)));
          break;
        }
        case "del":
        case "moveFrom": {
          const mark = this.revisionMark("suggestionDelete", element);
          if (mark) result.push(...(await this.inlineContent(element.children, { ...context, marks: [...context.marks, mark], deleted: true }, style)));
          break;
        }
        case "smartTag":
        case "customXml":
          result.push(...(await this.inlineContent(element.children, context, style)));
          break;
        case "commentRangeStart":
        case "commentRangeEnd":
          result.push(...this.commentMarker(element));
          break;
        case "sdt":
          result.push(...(await this.inlineContent(child(element, "sdtContent")?.children ?? [], context, style)));
          break;
        case "AlternateContent":
          result.push(...(await this.inlineContent([child(element, "Choice") ?? child(element, "Fallback")].filter((e) => !!e), context, style)));
          break;
        case "oMath":
          result.push(...this.equation(element, context, style));
          break;
        case "oMathPara":
          // A displayed equation (or several): each one an equation of its own.
          for (const math of element.children) if (math.name === "oMath") result.push(...this.equation(math, context, style));
          break;
        // Bookmarks, proofing marks and paragraph properties are left out.
      }
    }
    return result;
  }

  /** An Office Math equation as an equation node with its LaTeX (see omml.ts). */
  private equation(element: Element, context: InlineContext, style: ParagraphStyleId): JSONContent[] {
    const latex = toLatex(ommlToMath(element));
    if (!latex) return [];
    if (latex.length > MAX_EQUATION_LENGTH) {
      this.dropped.add("Equations too long to edit (kept as text)");
      return textNode(latex, this.runMarks(undefined, context, style));
    }
    const marks = this.runMarks(undefined, context, style);
    return [{ type: "equation", attrs: { latex }, ...(marks.length > 0 && { marks }) }];
  }

  private async run(run: Element, context: InlineContext, style: ParagraphStyleId): Promise<JSONContent[]> {
    const result: JSONContent[] = [];
    const properties = child(run, "rPr");
    // Hidden text, though a field's instruction and characters still count.
    const hidden = toggle(child(properties, "vanish")) === true;
    const tracked = context.marks.some((mark) => mark.type === "suggestionInsert" || mark.type === "suggestionDelete");
    if (!tracked && !child(properties, "rPrChange")) this.lastRevision = null;
    const marks = [...this.runMarks(properties, context, style), ...this.formatRevision(properties, context, style)];
    for (const element of run.children) {
      const field = this.fields[this.fields.length - 1];
      switch (element.name) {
        case "delText":
          if (!context.deleted) break;
        // falls through: deleted text inside a deletion is shown struck through.
        case "t":
          // Text between a field's begin and separate characters is its instruction, not shown text.
          // A page number field's result is drawn by the editor instead.
          if (!hidden && (!field || field.result) && !this.fields.some((open) => open.pageField)) {
            result.push(...textNode(element.text.replace(COMMENT_MARKER_CHARACTERS, ""), marks));
          }
          break;
        case "instrText":
        case "delInstrText":
          if (field && !field.result) field.instruction += element.text;
          break;
        case "fldChar": {
          const type = element.attributes.fldCharType;
          if (type === "begin") this.fields.push({ instruction: "", result: false });
          else if (type === "separate" && field) {
            field.result = true;
            field.link = hyperlinkField(field.instruction);
            field.pageField = pageFieldKind(field.instruction);
          } else if (type === "end") {
            const ended = this.fields.pop();
            const kind = ended && (ended.pageField ?? pageFieldKind(ended.instruction));
            if (kind) result.push({ type: "pageField", attrs: { kind } });
          }
          break;
        }
        case "tab":
          if (!hidden && (!field || field.result)) result.push(leafNode("tab", marks));
          break;
        case "noBreakHyphen":
          result.push(...textNode("‑", marks));
          break;
        case "br":
        case "cr":
          result.push(
            element.attributes.type === "page"
              ? { type: "pageBreak", attrs: this.inlineObjectRevision(context) }
              : element.attributes.type === "column"
                ? { type: "columnBreak", attrs: this.inlineObjectRevision(context) }
                : { type: "hardBreak" },
          );
          break;
        case "drawing":
        case "pict":
          result.push(...this.withObjectRevision(await this.drawing(element), context));
          break;
        case "AlternateContent": {
          const choice = child(element, "Choice") ?? child(element, "Fallback");
          const drawing = choice && (find(choice, "drawing") ?? find(choice, "pict"));
          if (drawing) result.push(...this.withObjectRevision(await this.drawing(drawing), context));
          break;
        }
        case "object": {
          // An embedded object shows its preview picture, when it has one in a format the editor reads.
          const preview = find(element, "imagedata") ? await this.drawing(element) : [];
          if (preview.length === 0) this.dropped.add("Embedded objects");
          result.push(...this.withObjectRevision(preview, context));
          break;
        }
        case "commentReference":
          if (element.attributes.id !== undefined && this.part === "body") {
            result.push(...textNode(commentMarker("reference", element.attributes.id), []));
          }
          break;
        case "footnoteReference":
        case "endnoteReference": {
          // An inserted or deleted footnote keeps the suggestion on its reference.
          const tracked = context.marks.filter((mark) => mark.type === "suggestionInsert" || mark.type === "suggestionDelete");
          const references = await this.footnoteReference(element.attributes.id, element.name === "endnoteReference");
          // Its text was inserted or deleted with it (as the export writes it): part of the same suggestion.
          const kind = tracked[0]?.type;
          result.push(
            ...references.map((node) =>
              kind ? { ...node, marks: tracked, attrs: { ...node.attrs, content: (node.attrs!.content as JSONContent[]).map((block) => withoutMark(block, kind)) } } : node,
            ),
          );
          break;
        }
      }
    }
    return result;
  }

  /**
   * A footnote reference with the footnote's text; an endnote becomes a footnote. Notes inside
   * headers or footnotes are dropped.
   */
  private async footnoteReference(id: string | undefined, endnote = false): Promise<JSONContent[]> {
    const footnote = id ? this.parts[endnote ? "endnotes" : "footnotes"].get(id) : undefined;
    const kind = endnote ? "Endnotes" : "Footnotes";
    if (!footnote || this.part !== "body") {
      this.dropped.add(this.part === "body" ? kind : `${kind} in headers, footers or footnotes`);
      return [];
    }
    if (endnote) this.dropped.add("Endnotes (shown as footnotes)");
    const converter = new DocxConverter(this.parts, footnote.rels, "footnote");
    const content = regionContent(await converter.blocks(footnote.element.children), "footnote") ?? [{ type: "paragraph" }];
    // The text usually starts with a space after the footnote's number.
    const first = content[0]?.content?.[0];
    if (first?.type === "text" && first.text) first.text = first.text.replace(/^\s+/, "");
    if (first?.type === "text" && !first.text) content[0]!.content!.shift();
    return [{ type: "footnote", attrs: { content } }];
  }

  /** A suggestion mark for a Word revision (w:ins, w:del, w:rPrChange), in the body, headers, footers and footnotes. */
  private revisionMark(type: string, element: Element, extra: Record<string, unknown> = {}): MarkJSON | null {
    return { type, attrs: { ...this.revision(element, type === "suggestionFormat" ? "format" : "change"), ...extra } };
  }

  private revision(element: Element, group: "change" | "format") {
    const attributes = revisionAttributes(element);
    const key = `${group}|${attributes.author}|${attributes.createdAt}`;
    if (this.lastRevision?.key === key) attributes.id = this.lastRevision.id;
    this.lastRevision = { key, id: attributes.id };
    return attributes;
  }

  /**
   * The `suggestionInsert` or `suggestionDelete` attribute of a row or cell from its revision, or
   * null. Each object is a suggestion of its own; the text in it joins that suggestion.
   */
  private objectRevision(inserted: Element | undefined, deleted: Element | undefined): Record<string, unknown> | null {
    const revision = deleted ?? inserted;
    if (!revision) return null;
    const attributes = revisionAttributes(revision);
    attributes.id = `${attributes.id}o${++this.objectCount}`;
    this.lastRevision = { key: `change|${attributes.author}|${attributes.createdAt}`, id: attributes.id };
    return deleted ? { suggestionDelete: attributes } : { suggestionInsert: attributes };
  }

  /** Objects made so far, for ids of their own. */
  private objectCount = 0;

  /** The attributes of an image or break inside w:ins or w:del: a suggestion of its own. */
  private inlineObjectRevision(context: InlineContext): Record<string, unknown> | undefined {
    const deleted = context.marks.find((mark) => mark.type === "suggestionDelete");
    const inserted = context.marks.find((mark) => mark.type === "suggestionInsert");
    const mark = deleted ?? inserted;
    if (!mark) return undefined;
    const attributes = { ...mark.attrs, id: `${String(mark.attrs?.id)}o${++this.objectCount}` };
    return deleted ? { suggestionDelete: attributes } : { suggestionInsert: attributes };
  }

  private withObjectRevision(nodes: JSONContent[], context: InlineContext): JSONContent[] {
    const revision = this.inlineObjectRevision(context);
    return revision ? nodes.map((node) => ({ ...node, attrs: { ...node.attrs, ...revision } })) : nodes;
  }

  /** A suggested format change, from the run properties before a tracked change (w:rPrChange). */
  private formatRevision(properties: Element | undefined, context: InlineContext, style: ParagraphStyleId): MarkJSON[] {
    const change = child(properties, "rPrChange");
    if (!change) return [];
    const formatting = (marks: MarkJSON[]) => marks.filter((mark) => !mark.type.startsWith("suggestion"));
    const before = formatting(this.runMarks(child(change, "rPr"), context, style));
    const after = formatting(this.runMarks(properties, context, style));
    if (sameJSON(before, after)) return [];
    const mark = this.revisionMark("suggestionFormat", change, { before });
    return mark ? [mark] : [];
  }

  /** A paragraph whose paragraph mark was inserted or deleted: the break after it is a suggestion. */
  private paragraphMarkRevision(properties: Element | undefined): Record<string, unknown> | null {
    const runProperties = child(properties, "rPr");
    const inserted = child(runProperties, "ins") ?? child(runProperties, "moveTo");
    const deleted = child(runProperties, "del") ?? child(runProperties, "moveFrom");
    const revision = deleted ?? inserted;
    return revision ? { kind: deleted ? "delete" : "insert", ...this.revision(revision, "change") } : null;
  }

  private runMarks(properties: Element | undefined, context: InlineContext, style: ParagraphStyleId): MarkJSON[] {
    const styleProperties = styleChain(this.styles, val(child(properties, "rStyle"))).map((charStyle) => charStyle.runProperties);
    // Direct formatting wins over the character style, and nearer styles over the ones they are based on.
    const layers = [properties, ...styleProperties].filter((layer): layer is Element => layer !== undefined);
    const property = (name: string) => layers.map((layer) => child(layer, name)).find((element) => element !== undefined);
    const on = (name: string) => toggle(property(name)) === true;

    const marks: MarkJSON[] = [...context.marks];
    const fieldLink = this.fields.findLast((field) => field.result && field.link)?.link;
    const link = context.link ?? fieldLink;
    if (link) marks.push({ type: "link", attrs: { href: link } });
    if (on("b")) marks.push({ type: "bold" });
    if (on("i")) marks.push({ type: "italic" });
    if (on("strike") || on("dstrike")) marks.push({ type: "strike" });
    // Links are underlined and coloured by the editor itself.
    const underline = val(property("u"));
    if (!link && !context.inHyperlink && property("u") && underline !== "none") marks.push({ type: "underline" });
    const vertical = val(property("vertAlign"));
    if (vertical === "superscript") marks.push({ type: "superscript" });
    if (vertical === "subscript") marks.push({ type: "subscript" });

    const textStyle: Record<string, string> = {};
    const color = val(property("color"));
    if (!link && color && /^[0-9a-f]{6}$/i.test(color) && color !== "000000") textStyle.color = `#${color.toLowerCase()}`;
    const size = number(val(property("sz")));
    if (size && size / 2 !== paragraphStyleDefinitions[style].fontSize) textStyle.fontSize = `${size / 2}pt`;
    const font = val(property("rFonts"), "ascii");
    if (font) textStyle.fontFamily = font;
    if (Object.keys(textStyle).length > 0) marks.push({ type: "textStyle", attrs: textStyle });

    const highlight = val(property("highlight"));
    const shading = val(property("shd"), "fill");
    const highlightColor = highlight && highlight !== "none" ? highlightColors[highlight] : shading && /^[0-9a-f]{6}$/i.test(shading) ? `#${shading.toLowerCase()}` : undefined;
    if (highlightColor) marks.push({ type: "highlight", attrs: { color: highlightColor } });
    return marks;
  }

  /** An image from a drawing; shapes, charts and text boxes have none and are reported. */
  private async drawing(element: Element): Promise<JSONContent[]> {
    const boxes = findAll(element, "txbxContent");
    if (boxes.length > 0) {
      // The editor has no text boxes or shapes: their text follows the paragraph they are anchored in.
      this.dropped.add("Text boxes and shapes (their text is kept)");
      const converter = new DocxConverter(this.parts, this.rels, this.part);
      for (const box of boxes) this.boxBlocks.push(...(await converter.blocks(box.children)));
      return [];
    }
    const blip = find(element, "blip") ?? find(element, "imagedata");
    const id = blip?.attributes.embed ?? blip?.attributes.id;
    const rel = id ? this.rels.get(id) : undefined;
    if (!rel || rel.external) {
      this.dropped.add(rel?.external ? "Linked images" : "Charts and shapes");
      return [];
    }
    const path = resolvePath(this.directory, rel.target);
    const data = await this.zip.file(path)?.async("uint8array");
    const src = data ? await this.storeImage(data) : null;
    if (!src) {
      this.dropped.add("Images in unsupported formats");
      return [];
    }
    const extent = find(element, "extent");
    const width = number(extent?.attributes.cx);
    const height = number(extent?.attributes.cy);
    const properties = find(element, "docPr")?.attributes;
    const alt = properties?.descr || null;
    const title = properties?.title || null;
    return [
      {
        type: "image",
        attrs: {
          src,
          alt,
          ...(title && { title }),
          ...(width && height && { width: Math.round(width / EMU_PER_PX), height: Math.round(height / EMU_PER_PX) }),
          ...drawingLayout(element, this.parts.margins),
        },
      },
    ];
  }

  // Tables -------------------------------------------------------------------------------------

  /** Tables the table being converted is nested in. */
  private tableDepth = 0;

  /**
   * A table nested deeper than the editor shows sensibly: its paragraphs (and those of the tables
   * in it), one after the other, found without recursion since such files nest thousands deep.
   */
  private async flattenedTable(element: Element): Promise<Entry[]> {
    this.dropped.add("Tables nested more than 5 deep (their text is kept)");
    const entries: Entry[] = [];
    const stack = [element];
    while (stack.length > 0) {
      const next = stack.pop()!;
      if (next.name === "p") {
        for (const entry of await this.paragraph(next)) {
          entries.push(...(entry.kind === "block" ? [entry] : entry.blocks.map((node) => ({ kind: "block" as const, node }))));
        }
        continue;
      }
      for (let index = next.children.length - 1; index >= 0; index--) stack.push(next.children[index]!);
    }
    return entries;
  }

  private async table(element: Element): Promise<JSONContent | null> {
    const rows: JSONContent[] = [];
    /** The cell that a vertically merged cell continues, by grid column. */
    const mergeOrigins = new Map<number, JSONContent>();
    // Column widths in twips; stored as CSS pixels (15 twips each), shown as proportions.
    const grid = (child(element, "tblGrid")?.children ?? [])
      .filter((candidate) => candidate.name === "gridCol")
      .map((column) => number(val(column, "w")));
    const hasGrid = grid.length > 0 && grid.every((width) => width !== undefined && width > 0);
    for (const row of unwrapped(element.children, "tr")) {
      const rowProperties = child(row, "trPr");
      const header = toggle(child(rowProperties, "tblHeader")) === true;
      // An inserted or deleted row (w:trPr/w:ins, w:del).
      const rowRevision = this.objectRevision(child(rowProperties, "ins"), child(rowProperties, "del"));
      let column = number(val(child(rowProperties, "gridBefore"))) ?? 0;
      const cells: JSONContent[] = [];
      for (const cell of unwrapped(row.children, "tc")) {
        const properties = child(cell, "tcPr");
        const colspan = Math.max(1, number(val(child(properties, "gridSpan"))) ?? 1);
        const merge = child(properties, "vMerge");
        const origin = mergeOrigins.get(column);
        if (merge && val(merge) !== "restart" && origin) {
          origin.attrs!.rowspan = (origin.attrs!.rowspan as number) + 1;
        } else {
          // An inserted or deleted cell (a column), read before its text so they share a suggestion.
          const cellRevision = rowRevision ? {} : this.objectRevision(child(properties, "cellIns"), child(properties, "cellDel"));
          const content = await this.blocks(cell.children);
          // The empty paragraph Word requires after a table at the end of a cell.
          const last = content.at(-1);
          if (content.at(-2)?.type === "table" && last?.type === "paragraph" && !last.content?.length) content.pop();
          const widths = grid.slice(column, column + colspan) as number[];
          const node: JSONContent = {
            type: header ? "tableHeader" : "tableCell",
            attrs: {
              ...cellRevision,
              colspan,
              rowspan: 1,
              ...(hasGrid && widths.length === colspan && { colwidth: widths.map((width) => Math.round(width / 15)) }),
            },
            content: content.length > 0 ? content : [emptyParagraph()],
          };
          cells.push(node);
          for (let spanned = column; spanned < column + colspan; spanned++) {
            if (merge) mergeOrigins.set(spanned, node);
            else mergeOrigins.delete(spanned);
          }
        }
        column += colspan;
      }
      rows.push({ type: "tableRow", ...(rowRevision && { attrs: rowRevision }), content: cells });
    }
    return rows.length > 0 ? { type: "table", content: rows } : null;
  }

  // Lists --------------------------------------------------------------------------------------

  /** Groups consecutive list items into (nested) lists; other blocks end the lists. */
  private groupLists(entries: Entry[]): JSONContent[] {
    const result: JSONContent[] = [];
    let open: { list: JSONContent; level: number; key: string }[] = [];
    for (const entry of entries) {
      if (entry.kind === "block") {
        open = [];
        result.push(entry.node);
        continue;
      }
      const { list, level } = entry;
      while (open.length > 0) {
        const top = open[open.length - 1]!;
        if (top.level > level || (top.level === level && top.key !== list.key)) open.pop();
        else break;
      }
      const top = open[open.length - 1];
      if (!top || top.level < level) {
        const node = this.newList(list, level);
        if (top) {
          const items = top.list.content!;
          if (items.length === 0) items.push(listItem(top.list, [emptyParagraph()]));
          items[items.length - 1]!.content!.push(node);
        } else {
          result.push(node);
        }
        open.push({ list: node, level, key: list.key });
      }
      const current = open[open.length - 1]!;
      current.list.content!.push(listItem(current.list, entry.blocks, entry.checked));
      const countKey = `${list.key}:${level}`;
      this.listCounts.set(countKey, (this.listCounts.get(countKey) ?? 0) + 1);
    }
    return result;
  }

  private newList(list: ListInfo, level: number): JSONContent {
    const attrs: Record<string, unknown> = { listPreset: list.preset };
    // Word continues a numbered list after other paragraphs, so the new list starts where it left
    // off. Nested levels restart under each item of the level above.
    if (list.type === "orderedList") {
      attrs.start = list.start + (level === 0 ? (this.listCounts.get(`${list.key}:${level}`) ?? 0) : 0);
    }
    return { type: list.type, attrs, content: [] };
  }
}

/** The elements named `name`, also those inside content controls and custom XML (rows and cells can be in them). */
function unwrapped(elements: Element[], name: string): Element[] {
  return elements.flatMap((element) => {
    if (element.name === name) return [element];
    if (element.name === "sdt") return unwrapped(child(element, "sdtContent")?.children ?? [], name);
    if (element.name === "customXml") return unwrapped(element.children, name);
    return [];
  });
}

function listItem(list: JSONContent, blocks: JSONContent[], checked?: boolean): JSONContent {
  if (list.type === "taskList") return { type: "taskItem", attrs: { checked: checked === true }, content: blocks };
  return { type: "listItem", content: blocks };
}

/** Word's tab stop kinds; decimal stops line up like right stops, bar and clear stops are left out. */
const tabStopKinds: Record<string, TabStopKind | undefined> = { left: "left", start: "left", center: "center", right: "right", end: "right", decimal: "right" };

/** Alignment, line spacing, space before and after, indentation and tab stops from the paragraph's own properties. */
function paragraphAttributes(properties: Element | undefined, style: ParagraphStyleId, inList: boolean): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  const alignment = alignments[val(child(properties, "jc")) ?? ""];
  if (alignment) attrs.textAlign = alignment;

  const spacing = child(properties, "spacing");
  const line = number(val(spacing, "line"));
  const rule = val(spacing, "lineRule");
  if (line && (!rule || rule === "auto")) {
    const lineSpacing = Math.round((line / 240) * 100) / 100;
    if (lineSpacing > 0 && lineSpacing !== 1.15) attrs.lineSpacing = lineSpacing;
  }
  const definition = paragraphStyleDefinitions[style];
  for (const [side, attribute] of [
    ["spaceBefore", "before"],
    ["spaceAfter", "after"],
  ] as const) {
    const twips = number(val(spacing, attribute));
    if (twips === undefined) continue;
    const points = Math.round((twips / TWIPS_PER_POINT) * 10) / 10;
    if (points !== definition[side]) attrs[side] = points;
  }

  const stops = storedTabStops(
    (child(properties, "tabs")?.children ?? []).flatMap((tab) => {
      const kind = tabStopKinds[val(tab) ?? ""];
      const pos = number(val(tab, "pos"));
      return tab.name === "tab" && kind && pos !== undefined && pos >= 0 ? [{ pos: pos / TWIPS_PER_POINT, kind }] : [];
    }),
  );
  if (stops) attrs.tabStops = stops;

  if (!inList) {
    const indentation = child(properties, "ind");
    const points = (twips: number | undefined) => (twips === undefined ? 0 : twips / TWIPS_PER_POINT);
    const hanging = number(val(indentation, "hanging"));
    const indents = indentAttributes({
      left: points(number(val(indentation, "left") ?? val(indentation, "start"))),
      right: points(number(val(indentation, "right") ?? val(indentation, "end"))),
      firstLine: hanging ? -points(hanging) : points(number(val(indentation, "firstLine"))),
    });
    for (const key of ["indentLeft", "indentFirstLine", "indentRight"] as const) if (indents[key] !== 0) attrs[key] = indents[key];
  }
  return attrs;
}

/** Content without one kind of suggestion mark. */
function withoutMark(node: JSONContent, type: string): JSONContent {
  const result: JSONContent = { ...node };
  if (node.marks) {
    const marks = node.marks.filter((mark) => mark.type !== type);
    if (marks.length > 0) result.marks = marks;
    else delete result.marks;
  }
  if (node.content) result.content = node.content.map((child) => withoutMark(child, type));
  return result;
}

/** Every Word revision becomes its own suggestion, with the revision's author and date. */
function revisionAttributes(element: Element): { id: string; author: string; createdAt: number } {
  const date = Date.parse(element.attributes.date ?? "");
  return {
    id: `w${String(element.attributes.id ?? "").slice(0, 32) || Math.random().toString(36).slice(2, 10)}`,
    author: (element.attributes.author ?? "").slice(0, 200) || "Unknown",
    createdAt: Number.isFinite(date) ? date : 0,
  };
}

const blockTypes = new Set(["image", "pageBreak", "columnBreak"]);

/** An image with a wrap mode other than in line: anchored to its paragraph, so it goes before it. */
function isAnchored(node: JSONContent): boolean {
  return node.type === "image" && typeof node.attrs?.wrap === "string" && node.attrs.wrap !== "inline";
}

/**
 * A paragraph with images or page breaks in it becomes text blocks around those blocks. Images that
 * are not in line with text are anchored to the paragraph: they go before all of it.
 */
function splitParagraph(textBlock: JSONContent, allInline: JSONContent[]): JSONContent[] {
  const anchored = allInline.filter(isAnchored);
  const inline = anchored.length > 0 ? allInline.filter((node) => !isAnchored(node)) : allInline;
  if (!inline.some((node) => blockTypes.has(node.type ?? ""))) return [...anchored, { ...textBlock, ...(inline.length > 0 && { content: inline }) }];
  const blocks: JSONContent[] = [...anchored];
  let run: JSONContent[] = [];
  const flush = () => {
    if (run.some((node) => node.type === "text" || node.type === "tab")) blocks.push({ ...textBlock, content: run });
    run = [];
  };
  for (const node of inline) {
    if (blockTypes.has(node.type ?? "")) {
      flush();
      blocks.push(node);
    } else {
      run.push(node);
    }
  }
  flush();
  return blocks;
}

const TASK_MARKER = /^\s*([☐☑☒])\s?/;

/** A paragraph that starts with a check box character, as the Word export writes checklist items. */
function taskMarker(block: JSONContent | undefined): { paragraph: JSONContent; checked: boolean } | null {
  if (block?.type !== "paragraph" || block.attrs?.paragraphStyle) return null;
  const [first, ...rest] = block.content ?? [];
  const match = first?.type === "text" ? TASK_MARKER.exec(first.text ?? "") : null;
  if (!match) return null;
  const remaining = first!.text!.slice(match[0].length);
  const content = [...(remaining ? [{ ...first, text: remaining }] : []), ...rest];
  return { paragraph: { ...block, ...(content.length > 0 ? { content } : { content: undefined }) }, checked: match[1] !== "☐" };
}

/** PAGE and NUMPAGES fields become page number and page count fields. */
function pageFieldKind(instruction: string): "page" | "count" | undefined {
  const name = instruction.trim().split(/\s+/)[0]?.toUpperCase();
  return name === "PAGE" ? "page" : name === "NUMPAGES" ? "count" : undefined;
}

function hyperlinkField(instruction: string): string | undefined {
  const match = instruction.match(/^\s*HYPERLINK\s+"([^"]+)"/);
  // `\l` links to a bookmark inside the document.
  return match && !/\\l/.test(instruction.slice(0, instruction.indexOf('"'))) ? match[1] : undefined;
}

function resolvePath(directory: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = `${directory}${target}`.split("/");
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === "..") resolved.pop();
    else if (part !== ".") resolved.push(part);
  }
  return resolved.join("/");
}

/**
 * The rotation, crop and (for anchored drawings) text wrapping and position of a drawing, as image
 * attributes. Positions from the margin are turned into positions from the column or the page.
 */
export function drawingLayout(element: Element, margins: { left: number; top: number }): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  const rotation = number(find(element, "xfrm")?.attributes.rot);
  if (rotation) attrs.rotation = normalizeRotation(rotation / 60000);
  const source = find(element, "srcRect")?.attributes;
  if (source) {
    const side = (name: string) => Math.max(0, (number(source[name]) ?? 0) / 100000);
    const crop = { top: side("t"), right: side("r"), bottom: side("b"), left: side("l") };
    if (isImageCrop(crop) && Object.values(crop).some((value) => value > 0)) attrs.crop = crop;
  }
  const anchor = find(element, "anchor");
  if (!anchor) return attrs;
  const wrapElement = anchor.children.find((candidate) => candidate.name.startsWith("wrap"));
  const wrap =
    wrapElement?.name === "wrapTopAndBottom"
      ? "break"
      : wrapElement && wrapElement.name !== "wrapNone"
        ? "wrap"
        : anchor.attributes.behindDoc === "1" || anchor.attributes.behindDoc === "true"
          ? "behind"
          : "front";
  attrs.wrap = wrap;
  const distance = Math.max(...["distT", "distB", "distL", "distR"].map((name) => number(anchor.attributes[name]) ?? 0));
  attrs.wrapMargin = Math.min(Math.round((distance / EMU_PER_POINT) * 100) / 100, MAX_IMAGE_MARGIN_PT);
  const horizontal = child(anchor, "positionH");
  const vertical = child(anchor, "positionV");
  const offset = (position: Element | undefined) => (number(child(position, "posOffset")?.text) ?? 0) / EMU_PER_PX;
  const fromV = vertical?.attributes.relativeFrom ?? "paragraph";
  const fromH = horizontal?.attributes.relativeFrom ?? "column";
  const fixed = fromV === "page" || fromV === "margin" || fromV === "topMargin";
  attrs.positioning = fixed ? "fixed" : "moveWithText";
  let x = offset(horizontal);
  let y = offset(vertical);
  // Behind and in front of text, a fixed image is placed from the page's left edge; otherwise from the column.
  const fromPageEdge = fixed && (wrap === "behind" || wrap === "front");
  if (fromPageEdge && fromH !== "page") x += margins.left;
  if (!fromPageEdge && fromH === "page") x -= margins.left;
  if (fixed && fromV !== "page") y += margins.top;
  attrs.offsetX = Math.round(x * 100) / 100;
  attrs.offsetY = Math.round(y * 100) / 100;
  return attrs;
}

const EMU_PER_POINT = 12700;

/** Columns of the last section, up to three. */
function columnSettings(section: Element): Record<string, unknown> {
  const columns = child(section, "cols");
  const count = number(val(columns, "num"));
  if (!columns || !count || count < 2) return {};
  const space = number(val(columns, "space"));
  return {
    columns: Math.min(count, MAX_COLUMNS),
    ...(space !== undefined && isColumnSpacing(space / TWIPS_PER_POINT) && { columnSpacing: space / TWIPS_PER_POINT }),
    ...(["1", "true", "on"].includes(val(columns, "sep") ?? "") && { columnLine: true }),
  };
}

const MM_PER_TWIP = 25.4 / 1440;
const PAPER_TOLERANCE_MM = 3;

/** Paper size, orientation and margins of the last section, where they match the editor's options. */
function pageSetup(section: Element): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  const size = child(section, "pgSz");
  const width = number(val(size, "w"));
  const height = number(val(size, "h"));
  if (width && height) {
    const landscape = val(size, "orient") === "landscape" || width > height;
    const [short, long] = [Math.min(width, height) * MM_PER_TWIP, Math.max(width, height) * MM_PER_TWIP];
    const paper = Object.entries(paperSizes).find(
      ([, candidate]) => Math.abs(candidate.width - short) < PAPER_TOLERANCE_MM && Math.abs(candidate.height - long) < PAPER_TOLERANCE_MM,
    );
    if (paper) {
      attrs.paperSize = paper[0];
      attrs.orientation = landscape ? "landscape" : "portrait";
    }
  }
  const margins = child(section, "pgMar");
  for (const [attribute, key] of [
    ["top", "marginTop"],
    ["bottom", "marginBottom"],
    ["left", "marginLeft"],
    ["right", "marginRight"],
  ] as const) {
    const twips = number(val(margins, attribute));
    const points = twips === undefined ? undefined : Math.round((Math.abs(twips) / TWIPS_PER_POINT) * 10) / 10;
    if (isMargin(points)) attrs[key] = points;
  }
  return attrs;
}

// ---------------------------------------------------------------------------------------------
// Comments
//
// While the document is built, the start and end of every comment's range are private-use
// characters with the comment's id in the text. Once the document is complete their positions are
// read and the characters removed, so the ranges are positions in the final document.

type MarkerKind = "start" | "end" | "reference";
const markerCharacters: Record<MarkerKind, string> = { start: "\u{10FFF0}", end: "\u{10FFF1}", reference: "\u{10FFF3}" };
const COMMENT_CLOSE = "\u{10FFF2}";
const COMMENT_MARKER_CHARACTERS = /[\u{10FFF0}-\u{10FFF3}]/gu;
const COMMENT_MARKER = /([\u{10FFF0}\u{10FFF1}\u{10FFF3}])([^\u{10FFF2}]*)\u{10FFF2}/gu;

function commentMarker(kind: MarkerKind, id: string): string {
  return `${markerCharacters[kind]}${id.replace(COMMENT_MARKER_CHARACTERS, "")}${COMMENT_CLOSE}`;
}

/** Appends inline content to the last paragraph or heading of `blocks` (or a new paragraph). */
function appendToLastTextblock(blocks: JSONContent[], inline: JSONContent[]): void {
  for (let index = blocks.length - 1; index >= 0; index--) {
    const block = blocks[index]!;
    if (block.type === "paragraph" || block.type === "heading") {
      block.content = [...(block.content ?? []), ...inline];
      return;
    }
    if (block.content && block.type !== "image") {
      const before = block.content.length;
      appendToLastTextblock(block.content, inline);
      if (block.content.length === before) return;
      block.content.pop();
    }
  }
  blocks.push({ type: "paragraph", content: inline });
}

/** A comment's range, and where its reference mark is (the only place a comment without a range has). */
type CommentRange = { from?: number; to?: number; reference?: number };

/** The document without its comment markers, and the range of every comment by id. */
function commentRanges(doc: Node): { doc: Node; ranges: Map<string, CommentRange> } {
  const markers: { pos: number; length: number; id: string; kind: MarkerKind }[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    for (const match of node.text!.matchAll(COMMENT_MARKER)) {
      const kind = (Object.keys(markerCharacters) as MarkerKind[]).find((candidate) => markerCharacters[candidate] === match[1])!;
      markers.push({ pos: pos + match.index, length: match[0].length, id: match[2]!, kind });
    }
    return false;
  });
  const ranges = new Map<string, CommentRange>();
  if (markers.length === 0) return { doc, ranges };
  const transform = new Transform(doc);
  for (const marker of [...markers].reverse()) transform.delete(marker.pos, marker.pos + marker.length);
  let removed = 0;
  for (const marker of markers) {
    const range = ranges.get(marker.id) ?? {};
    const pos = marker.pos - removed;
    if (marker.kind === "start") range.from ??= pos;
    else if (marker.kind === "end") range.to = pos;
    else range.reference ??= pos;
    ranges.set(marker.id, range);
    removed += marker.length;
  }
  return { doc: transform.doc, ranges };
}

/**
 * The range a comment is attached to: its own, or for a comment that only has a reference mark,
 * the word before the mark (or else after it) in its paragraph. Null when there is no text.
 */
function anchorOf(doc: Node, range: CommentRange | undefined): { from: number; to: number } | null {
  if (range?.from !== undefined && range.to !== undefined && range.to > range.from) return { from: range.from, to: range.to };
  const at = range?.reference ?? range?.from ?? range?.to;
  if (at === undefined) return null;
  const $at = doc.resolve(at);
  if (!$at.parent.isTextblock) return null;
  const start = $at.start();
  const before = $at.parent.textBetween(0, $at.parentOffset, undefined, "\ufffc");
  const after = $at.parent.textBetween($at.parentOffset, $at.parent.content.size, undefined, "\ufffc");
  const previous = /(\S+)\s*$/.exec(before);
  if (previous) return { from: start + previous.index, to: start + previous.index + previous[1]!.length };
  const next = /^\s*(\S+)/.exec(after);
  if (next) return { from: at + next[0].length - next[1]!.length, to: at + next[0].length };
  return null;
}

/** The text of a comment's paragraphs, one line each. */
function commentText(comment: Element): string {
  const lines: string[] = [];
  for (const paragraph of findAll(comment, "p")) {
    let line = "";
    const stack = [...paragraph.children].reverse();
    while (stack.length > 0) {
      const next = stack.pop()!;
      if (next.name === "t") line += next.text;
      else if (next.name === "tab") line += "\t";
      else if (next.name === "br" || next.name === "cr") line += "\n";
      // The annotation reference is Word's own mark for the comment, not text.
      else if (next.name !== "rPr" && next.name !== "pPr") for (let index = next.children.length - 1; index >= 0; index--) stack.push(next.children[index]!);
    }
    lines.push(line);
  }
  return lines.join("\n").trim();
}

/**
 * Comment threads from the comments part, with replies (commentsExtended's parent paragraph) after
 * their comment and whether the thread is resolved. A thread is anchored at its first comment's
 * range; comments without a range in the body are left out (and reported).
 */
function commentThreads(
  doc: Node,
  part: Element | null,
  extended: Element | null,
  ranges: Map<string, CommentRange>,
  dropped: DroppedContent,
): ImportedComment[] {
  type Entry = { id: string; paraIds: string[]; body: string; createdAt: number | null; parent?: string; done: boolean };
  const entries: Entry[] = [];
  for (const comment of find(part, "comments")?.children ?? []) {
    if (comment.name !== "comment" || comment.attributes.id === undefined) continue;
    const date = Date.parse(comment.attributes.date ?? "");
    entries.push({
      id: comment.attributes.id,
      paraIds: findAll(comment, "p").map((paragraph) => paragraph.attributes.paraId).filter((id): id is string => id !== undefined),
      body: commentText(comment),
      createdAt: Number.isFinite(date) ? date : null,
      done: false,
    });
  }
  // Each comment's last paragraph identifies it in commentsExtended.
  const byParaId = new Map(entries.flatMap((entry) => (entry.paraIds.length > 0 ? [[entry.paraIds.at(-1)!, entry] as const] : [])));
  for (const extra of find(extended, "commentsEx")?.children ?? []) {
    const entry = byParaId.get(extra.attributes.paraId ?? "");
    if (!entry) continue;
    entry.parent = byParaId.get(extra.attributes.paraIdParent ?? "")?.id;
    entry.done = ["1", "true"].includes(extra.attributes.done ?? "");
  }
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const rootOf = (entry: Entry) => {
    let root = entry;
    for (let depth = 0; root.parent !== undefined && byId.has(root.parent) && depth < 100; depth++) root = byId.get(root.parent)!;
    return root;
  };
  const threads = new Map<string, Entry[]>();
  for (const entry of entries) {
    const root = rootOf(entry);
    threads.set(root.id, [...(threads.get(root.id) ?? []), entry]);
  }
  const result: ImportedComment[] = [];
  for (const [rootId, thread] of threads) {
    const range = anchorOf(doc, ranges.get(rootId));
    if (!range) {
      dropped.add("Comments without text to attach them to");
      continue;
    }
    const [root, ...replies] = thread;
    replies.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    result.push({
      from: range.from,
      to: range.to,
      resolved: thread.some((entry) => entry.done),
      messages: [root!, ...replies].filter((entry) => entry.body).map((entry) => ({ body: entry.body, createdAt: entry.createdAt })),
    });
  }
  return result.sort((a, b) => a.from - b.from);
}
