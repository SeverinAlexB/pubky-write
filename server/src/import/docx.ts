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
//
// Headers, footers, footnotes, comments, equations, text boxes, charts and embedded objects are
// dropped and reported. Deleted tracked changes are left out and inserted ones kept.
import { bulletPresets, isMargin, numberedPresets, paperSizes, paragraphStyleDefinitions, type ParagraphStyleId } from "@docs/shared";
import type { JSONContent } from "@tiptap/core";
import JSZip from "jszip";
import { xml2js } from "xml-js";
import {
  DroppedContent,
  emptyParagraph,
  finishDocument,
  ImportError,
  textNode,
  type ImageStore,
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

  const converter = new DocxConverter(
    zip,
    directory,
    parseStyles(await readPart(zip, `${directory}styles.xml`)),
    parseNumbering(await readPart(zip, `${directory}numbering.xml`)),
    parseRelationships(await readPart(zip, relsPath)),
    options.storeImage,
  );
  const body = find(document, "body");
  if (!body) throw new ImportError("The Word document has no body");
  const blocks = await converter.blocks(body.children);
  const section = body.children.findLast((child) => child.name === "sectPr");
  if (section?.children.some((child) => child.name === "headerReference" || child.name === "footerReference")) {
    converter.dropped.add("Headers and footers");
  }
  return { doc: finishDocument(blocks, options, section ? pageSetup(section) : {}), dropped: converter.dropped.list() };
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

function toElement(node: XmlNode): Element {
  const attributes: Record<string, string> = {};
  for (const [name, value] of Object.entries(node.attributes ?? {})) {
    if (value !== undefined) attributes[localName(name)] = String(value);
  }
  const children: Element[] = [];
  let text = "";
  for (const child of node.elements ?? []) {
    if (child.type === "element") children.push(toElement(child));
    else if (child.type === "text" || child.type === "cdata") text += String(child.text ?? (child as { cdata?: string }).cdata ?? "");
  }
  return { name: localName(node.name ?? ""), attributes, children, text };
}

function child(element: Element | undefined, name: string): Element | undefined {
  return element?.children.find((candidate) => candidate.name === name);
}

/** The first descendant named `name`, depth first. */
function find(element: Element | undefined | null, name: string): Element | undefined {
  if (!element) return undefined;
  for (const candidate of element.children) {
    if (candidate.name === name) return candidate;
    const found = find(candidate, name);
    if (found) return found;
  }
  return undefined;
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

type Field = { instruction: string; result: boolean; link?: string };

type InlineContext = { marks: MarkJSON[]; link?: string; inHyperlink: boolean };

class DocxConverter {
  readonly dropped = new DroppedContent();
  private readonly fields: Field[] = [];
  /** How many items each numbered list (by numbering instance and level) has had, so interrupted lists continue. */
  private readonly listCounts = new Map<string, number>();

  constructor(
    private readonly zip: JSZip,
    private readonly directory: string,
    private readonly styles: Styles,
    private readonly numbering: Numbering,
    private readonly rels: Map<string, Relationship>,
    private readonly storeImage: ImageStore,
  ) {}

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
        const table = await this.table(element);
        return table ? [{ kind: "block", node: table }] : [];
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
      default:
        return [];
    }
  }

  // Paragraphs ---------------------------------------------------------------------------------

  private async paragraph(element: Element): Promise<Entry[]> {
    const properties = child(element, "pPr");
    const styleId = val(child(properties, "pStyle"));
    const style = paragraphStyleId(this.styles, styleId);
    const inline = await this.inlineContent(element.children, { marks: [], inHyperlink: false }, style);

    const list = style.startsWith("h") ? null : this.listOf(properties, styleId);
    const level = list ? (number(val(child(child(properties, "numPr") ?? this.styleNumbering(styleId), "ilvl"))) ?? 0) : 0;
    const attrs = paragraphAttributes(properties, style, list !== null);
    const textBlock: JSONContent = style.startsWith("h")
      ? { type: "heading", attrs: { ...attrs, level: Number(style.slice(1)) } }
      : { type: "paragraph", attrs: { ...attrs, ...(style !== "normal" && { paragraphStyle: style }) } };

    const blocks = splitParagraph(textBlock, inline);
    const pageBreakBefore = toggle(child(properties, "pageBreakBefore")) ? [{ kind: "block" as const, node: { type: "pageBreak" } }] : [];

    if (list) return [...pageBreakBefore, { kind: "item", list, level: Math.min(level, MAX_INDENT), blocks }];

    const task = taskMarker(blocks[0]);
    if (task) {
      const indent = number(val(child(properties, "ind"), "left") ?? val(child(properties, "ind"), "start")) ?? TWIPS_PER_INDENT;
      const taskList: ListInfo = { type: "taskList", key: "task", preset: 0, start: 1 };
      const level = Math.max(0, Math.min(MAX_INDENT, Math.round(indent / TWIPS_PER_INDENT) - 1));
      const first = { ...task.paragraph, attrs: { ...task.paragraph.attrs, indent: 0 } };
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
          if (!link && element.attributes.anchor) this.dropped.add("Links to places in the document");
          result.push(...(await this.inlineContent(element.children, { ...context, link: link ?? context.link, inHyperlink: true }, style)));
          break;
        }
        case "fldSimple": {
          const link = hyperlinkField(element.attributes.instr ?? "");
          result.push(...(await this.inlineContent(element.children, { ...context, link: link ?? context.link }, style)));
          break;
        }
        case "ins":
        case "moveTo":
        case "smartTag":
        case "customXml":
          result.push(...(await this.inlineContent(element.children, context, style)));
          break;
        case "sdt":
          result.push(...(await this.inlineContent(child(element, "sdtContent")?.children ?? [], context, style)));
          break;
        case "AlternateContent":
          result.push(...(await this.inlineContent([child(element, "Choice") ?? child(element, "Fallback")].filter((e) => !!e), context, style)));
          break;
        case "oMath":
        case "oMathPara":
          this.dropped.add("Equations");
          break;
        // Deleted text (del, moveFrom), bookmarks, proofing marks and paragraph properties are left out.
      }
    }
    return result;
  }

  private async run(run: Element, context: InlineContext, style: ParagraphStyleId): Promise<JSONContent[]> {
    const result: JSONContent[] = [];
    const properties = child(run, "rPr");
    // Hidden text, though a field's instruction and characters still count.
    const hidden = toggle(child(properties, "vanish")) === true;
    const marks = this.runMarks(properties, context, style);
    for (const element of run.children) {
      const field = this.fields[this.fields.length - 1];
      switch (element.name) {
        case "t":
          // Text between a field's begin and separate characters is its instruction, not shown text.
          if (!hidden && (!field || field.result)) result.push(...textNode(element.text, marks));
          break;
        case "instrText":
          if (field && !field.result) field.instruction += element.text;
          break;
        case "fldChar": {
          const type = element.attributes.fldCharType;
          if (type === "begin") this.fields.push({ instruction: "", result: false });
          else if (type === "separate" && field) {
            field.result = true;
            field.link = hyperlinkField(field.instruction);
          } else if (type === "end") this.fields.pop();
          break;
        }
        case "tab":
          result.push(...textNode("\t", marks));
          break;
        case "noBreakHyphen":
          result.push(...textNode("‑", marks));
          break;
        case "br":
        case "cr":
          result.push(element.attributes.type === "page" ? { type: "pageBreak" } : { type: "hardBreak" });
          break;
        case "drawing":
        case "pict":
          result.push(...(await this.drawing(element)));
          break;
        case "AlternateContent": {
          const choice = child(element, "Choice") ?? child(element, "Fallback");
          const drawing = choice && (find(choice, "drawing") ?? find(choice, "pict"));
          if (drawing) result.push(...(await this.drawing(drawing)));
          break;
        }
        case "object":
          this.dropped.add("Embedded objects");
          break;
        case "footnoteReference":
        case "endnoteReference":
          this.dropped.add("Footnotes");
          break;
        case "commentReference":
          this.dropped.add("Comments");
          break;
      }
    }
    return result;
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
    if (find(element, "txbxContent")) {
      this.dropped.add("Text boxes");
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
    const alt = find(element, "docPr")?.attributes.descr || null;
    return [
      {
        type: "image",
        attrs: {
          src,
          alt,
          ...(width && height && { width: Math.round(width / EMU_PER_PX), height: Math.round(height / EMU_PER_PX) }),
        },
      },
    ];
  }

  // Tables -------------------------------------------------------------------------------------

  private async table(element: Element): Promise<JSONContent | null> {
    const rows: JSONContent[] = [];
    /** The cell that a vertically merged cell continues, by grid column. */
    const mergeOrigins = new Map<number, JSONContent>();
    for (const row of element.children.filter((candidate) => candidate.name === "tr")) {
      const rowProperties = child(row, "trPr");
      const header = toggle(child(rowProperties, "tblHeader")) === true;
      let column = number(val(child(rowProperties, "gridBefore"))) ?? 0;
      const cells: JSONContent[] = [];
      for (const cell of row.children.filter((candidate) => candidate.name === "tc")) {
        const properties = child(cell, "tcPr");
        const colspan = Math.max(1, number(val(child(properties, "gridSpan"))) ?? 1);
        const merge = child(properties, "vMerge");
        const origin = mergeOrigins.get(column);
        if (merge && val(merge) !== "restart" && origin) {
          origin.attrs!.rowspan = (origin.attrs!.rowspan as number) + 1;
        } else {
          const content = await this.blocks(cell.children);
          const node: JSONContent = {
            type: header ? "tableHeader" : "tableCell",
            attrs: { colspan, rowspan: 1 },
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
      rows.push({ type: "tableRow", content: cells });
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

function listItem(list: JSONContent, blocks: JSONContent[], checked?: boolean): JSONContent {
  if (list.type === "taskList") return { type: "taskItem", attrs: { checked: checked === true }, content: blocks };
  return { type: "listItem", content: blocks };
}

/** Alignment, line spacing, space before and after, and indentation from the paragraph's own properties. */
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

  if (!inList) {
    const indentation = child(properties, "ind");
    const left = number(val(indentation, "left") ?? val(indentation, "start"));
    const indent = left ? Math.round(left / TWIPS_PER_INDENT) : 0;
    if (indent > 0) attrs.indent = Math.min(indent, MAX_INDENT);
  }
  return attrs;
}

const blockTypes = new Set(["image", "pageBreak"]);

/** A paragraph with images or page breaks in it becomes text blocks around those blocks. */
function splitParagraph(textBlock: JSONContent, inline: JSONContent[]): JSONContent[] {
  if (!inline.some((node) => blockTypes.has(node.type ?? ""))) return [{ ...textBlock, ...(inline.length > 0 && { content: inline }) }];
  const blocks: JSONContent[] = [];
  let run: JSONContent[] = [];
  const flush = () => {
    if (run.some((node) => node.type === "text")) blocks.push({ ...textBlock, content: run });
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
