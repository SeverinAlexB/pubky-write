// Converts a document to a Word file with the `docx` library. Suggestions become tracked changes:
// insertions and deletions (w:ins, w:del), text format changes (w:rPrChange) and inserted or deleted
// paragraph marks for suggested paragraph breaks.
import {
  AlignmentType,
  Bookmark,
  BorderStyle,
  DeletedTextRun,
  Document,
  ExternalHyperlink,
  Footer,
  FootnoteReferenceRun,
  Header,
  HeadingLevel,
  HeightRule,
  ImageRun,
  InsertedTextRun,
  InternalHyperlink,
  LeaderType,
  LevelFormat,
  Packer,
  PageBreak,
  PageNumber,
  PageOrientation,
  Paragraph,
  ShadingType,
  Tab,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TabStopType,
  TextRun,
  WidthType,
  type INumberingOptions,
  type IParagraphOptions,
  type IRunOptions,
  type IStylesOptions,
  type ParagraphChild,
} from "docx";
import { imageSize } from "image-size";
import { Mark, type Node } from "@tiptap/pm/model";
import { TableMap } from "@tiptap/pm/tables";
import {
  bulletPresets,
  columnFractions,
  DEFAULT_TABLE_BORDER_COLOR,
  DEFAULT_TABLE_BORDER_WIDTH_PT,
  isSize,
  DEFAULT_LINE_SPACING,
  documentSchema,
  isEmptyRegion,
  listPresetIndex,
  numberedPresets,
  pageElementsOf,
  pageSetupOf,
  paragraphIndents,
  DEFAULT_PAGE_COLOR,
  pageSizeMm,
  paperSizes,
  paragraphStyleDefinitions,
  tabStopsOf,
  tocHeadings,
  tocTarget,
  type BreakSuggestion,
  type MarkJSON,
  type NumberFormat,
  type ParagraphStyleDefinition,
  type RegionContent,
  type RegionKey,
} from "@docs/shared";

export type ImageReader = (src: string) => Promise<Buffer | null>;

type Block = Paragraph | Table;
type ListKind = "bullet" | "ordered" | "task";
/** Nested lists of the same kind use the preset and numbering instance of their outermost list. */
type ListContext = { kind: ListKind; level: number; instance: number; preset: number };

const MAX_IMAGE_WIDTH_PX = 600;
/** Half an inch, matching the editor's indent step. */
const TWIPS_PER_INDENT = 720;
const TWIPS_PER_POINT = 20;
/** A CSS pixel is 1/96 inch: 15 twips. */
const TWIPS_PER_PX = 15;
const LIST_LEVELS = 9;
const SUBTITLE_STYLE = "Subtitle";

const alignments = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
} as const;

const headings = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const;

const numberFormats: Record<NumberFormat, (typeof LevelFormat)[keyof typeof LevelFormat]> = {
  decimal: LevelFormat.DECIMAL,
  "decimal-leading-zero": LevelFormat.DECIMAL_ZERO,
  "lower-alpha": LevelFormat.LOWER_LETTER,
  "upper-alpha": LevelFormat.UPPER_LETTER,
  "lower-roman": LevelFormat.LOWER_ROMAN,
  "upper-roman": LevelFormat.UPPER_ROMAN,
};

export async function toDocx(doc: Node, title: string, readImage: ImageReader): Promise<Buffer> {
  const converter = new DocxConverter(readImage, contentWidthTwips(doc), doc);
  const children = await converter.blocks(doc);
  const settings = pageElementsOf(doc);
  const region = async (key: RegionKey, Kind: typeof Header | typeof Footer, always: boolean) => {
    const content = settings[key];
    if (isEmptyRegion(content) && !always) return undefined;
    const blocks = content && !isEmptyRegion(content) ? await converter.blocks(regionDoc(content)) : [];
    return new Kind({ children: blocks.length > 0 ? blocks : [new Paragraph("")] });
  };
  // With a different first page, page 1 gets its own (possibly empty) header and footer.
  const first = settings.differentFirstPage;
  const headers = { default: await region("header", Header, false), ...(first && { first: await region("firstPageHeader", Header, true) }) };
  const footers = { default: await region("footer", Footer, false), ...(first && { first: await region("firstPageFooter", Footer, true) }) };
  const properties = sectionProperties(doc);
  const { pageColor } = pageSetupOf(doc);
  const file = new Document({
    title,
    ...(pageColor !== DEFAULT_PAGE_COLOR && { background: { color: pageColor.slice(1).toUpperCase() } }),
    styles,
    numbering,
    footnotes: converter.footnotes,
    sections: [
      {
        properties: {
          ...properties,
          page: { ...properties.page, ...(settings.pageNumberStart !== 1 && { pageNumbers: { start: settings.pageNumberStart } }) },
          ...(first && { titlePage: true }),
        },
        headers,
        footers,
        children,
      },
    ],
  });
  return Packer.toBuffer(file);
}

/** Header, footer or footnote content as a document node. */
function regionDoc(content: RegionContent): Node {
  return documentSchema.nodeFromJSON({ type: "doc", content });
}

const TWIPS_PER_MM = 1440 / 25.4;

/** The width between the page's left and right margins. */
function contentWidthTwips(doc: Node): number {
  const setup = pageSetupOf(doc);
  return Math.round(pageSizeMm(setup).width * TWIPS_PER_MM - (setup.marginLeft + setup.marginRight) * TWIPS_PER_POINT);
}

/** Page size, orientation and margins from File > Page setup. */
function sectionProperties(doc: Node) {
  const setup = pageSetupOf(doc);
  const paper = paperSizes[setup.paperSize];
  const twips = (points: number) => Math.round(points * TWIPS_PER_POINT);
  return {
    page: {
      // Portrait dimensions; the library swaps them for landscape.
      size: {
        width: Math.round(paper.width * TWIPS_PER_MM),
        height: Math.round(paper.height * TWIPS_PER_MM),
        orientation: setup.orientation === "landscape" ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
      },
      margin: {
        top: twips(setup.marginTop),
        bottom: twips(setup.marginBottom),
        left: twips(setup.marginLeft),
        right: twips(setup.marginRight),
      },
    },
  };
}

/** Word's paragraph style for one of the editor's styles. */
function wordStyle(style: ParagraphStyleDefinition, id: string, name: string) {
  return {
    id,
    name,
    basedOn: "Normal",
    next: "Normal",
    quickFormat: true,
    run: {
      font: "Arial",
      size: style.fontSize * 2,
      color: style.color.slice(1).toUpperCase(),
      italics: style.italic,
      bold: false,
    },
    paragraph: {
      spacing: { before: style.spaceBefore * TWIPS_PER_POINT, after: style.spaceAfter * TWIPS_PER_POINT },
      keepNext: true,
    },
  };
}

const styles: IStylesOptions = {
  default: {
    document: {
      run: { font: "Arial", size: paragraphStyleDefinitions.normal.fontSize * 2 },
      paragraph: { spacing: { line: Math.round(240 * DEFAULT_LINE_SPACING), before: 0, after: 0 } },
    },
    title: wordStyle(paragraphStyleDefinitions.title, "Title", "Title"),
    heading1: wordStyle(paragraphStyleDefinitions.h1, "Heading1", "Heading 1"),
    heading2: wordStyle(paragraphStyleDefinitions.h2, "Heading2", "Heading 2"),
    heading3: wordStyle(paragraphStyleDefinitions.h3, "Heading3", "Heading 3"),
    heading4: wordStyle(paragraphStyleDefinitions.h4, "Heading4", "Heading 4"),
    heading5: wordStyle(paragraphStyleDefinitions.h5, "Heading5", "Heading 5"),
    heading6: wordStyle(paragraphStyleDefinitions.h6, "Heading6", "Heading 6"),
  },
  paragraphStyles: [wordStyle(paragraphStyleDefinitions.subtitle, SUBTITLE_STYLE, "Subtitle")],
};

/** Hanging indent of list level `level`: text at 0.5 in per level, the glyph 0.25 in before it. */
const listIndent = (level: number) => ({ paragraph: { indent: { left: TWIPS_PER_INDENT * (level + 1), hanging: 360 } } });

const bulletReference = (preset: number) => `bullet-${preset}`;
const orderedReference = (preset: number) => `ordered-${preset}`;

/** One Word numbering definition per bulleted and numbered preset. */
const numbering: INumberingOptions = {
  config: [
    ...bulletPresets.map(({ glyphs }, preset) => ({
      reference: bulletReference(preset),
      levels: Array.from({ length: LIST_LEVELS }, (_, level) => ({
        level,
        format: LevelFormat.BULLET,
        text: glyphs[level % glyphs.length]!,
        alignment: AlignmentType.START,
        style: listIndent(level),
      })),
    })),
    ...numberedPresets.map(({ formats, suffix, nested }, preset) => ({
      reference: orderedReference(preset),
      levels: Array.from({ length: LIST_LEVELS }, (_, level) => ({
        level,
        format: numberFormats[formats[level % formats.length]!],
        text: nested
          ? `${Array.from({ length: level + 1 }, (_, parent) => `%${parent + 1}`).join(".")}${suffix}`
          : `%${level + 1}${suffix}`,
        alignment: AlignmentType.START,
        style: listIndent(level),
      })),
    })),
  ],
};

/** Bookmark name of the n-th heading, for links from a table of contents. */
const headingBookmark = (index: number) => `_Toc${index}`;

class DocxConverter {
  private listCount = 0;
  /** Word footnotes by id, in the order of their references. */
  readonly footnotes: Record<number, { children: Paragraph[] }> = {};
  private footnoteCount = 0;
  /** Headings a table of contents links to, by node, with their bookmark index. */
  private readonly linkedHeadings = new Map<Node, number>();
  /** Suggested paragraph breaks, by the textblock before them: Word marks that paragraph's mark as inserted or deleted. */
  private readonly paragraphMarks = new Map<Node, BreakSuggestion>();
  /** Word needs a unique id on every revision element. */
  private revisionCount = 0;

  constructor(
    private readonly readImage: ImageReader,
    private readonly contentWidth: number,
    private readonly doc: Node,
  ) {
    let linked = false;
    doc.descendants((node) => {
      if (node.type.name === "tableOfContents" && node.attrs.style === "links") linked = true;
      return !linked && node.isBlock && !node.isTextblock;
    });
    if (linked) tocHeadings(doc).forEach((heading, index) => this.linkedHeadings.set(doc.nodeAt(heading.pos)!, index));
    let previous: Node | null = null;
    doc.descendants((node) => {
      if (!node.isTextblock) return true;
      const brk = node.attrs.suggestionBreak as BreakSuggestion | null | undefined;
      if (brk && previous) this.paragraphMarks.set(previous, brk);
      previous = node;
      return false;
    });
  }

  /** Revision attributes of a suggestion: a new id, its author and date. */
  private revision(meta: { author?: unknown; createdAt?: unknown }) {
    return {
      id: ++this.revisionCount,
      author: typeof meta.author === "string" && meta.author ? meta.author : "Unknown",
      date: new Date(typeof meta.createdAt === "number" ? meta.createdAt : 0).toISOString(),
    };
  }

  /** The paragraph mark of a textblock followed by a suggested paragraph break, as an inserted or deleted mark. */
  private paragraphMark(node: Node): Partial<IParagraphOptions> {
    const brk = this.paragraphMarks.get(node);
    if (!brk) return {};
    return { run: brk.kind === "insert" ? { insertion: this.revision(brk) } : { deletion: this.revision(brk) } };
  }

  /** A run, as a tracked insertion or deletion, or with its formatting before a suggested format change. */
  private run(options: IRunOptions, marks: readonly Mark[]): ParagraphChild {
    const find = (name: string) => marks.find((mark) => mark.type.name === name);
    const deleted = find("suggestionDelete");
    if (deleted) return new DeletedTextRun({ ...options, ...this.revision(deleted.attrs) });
    const inserted = find("suggestionInsert");
    if (inserted) return new InsertedTextRun({ ...options, ...this.revision(inserted.attrs) });
    const format = find("suggestionFormat");
    if (format) {
      const before = (format.attrs.before as MarkJSON[]).flatMap((json) => {
        try {
          return [Mark.fromJSON(documentSchema, json)];
        } catch {
          return [];
        }
      });
      // Word expects run properties in the change; "not bold" stands for plain text.
      const previous = runOptions(before);
      const properties = Object.values(previous).some((value) => value !== undefined) ? previous : { bold: false };
      return new TextRun({ ...options, revision: { ...properties, ...this.revision(format.attrs) } });
    }
    return new TextRun(options);
  }

  async blocks(parent: Node, list?: ListContext, quoted = false): Promise<Block[]> {
    const blocks: Block[] = [];
    for (const node of children(parent)) blocks.push(...(await this.block(node, list, quoted)));
    return blocks;
  }

  private async block(node: Node, list: ListContext | undefined, quoted: boolean): Promise<Block[]> {
    const base: IParagraphOptions = {
      alignment: alignments[node.attrs.textAlign as keyof typeof alignments],
      ...(spacing(node) && { spacing: spacing(node) }),
      ...(!list && indentation(node) && { indent: indentation(node) }),
      ...(tabStops(node) && { tabStops: tabStops(node) }),
      ...(quoted && { indent: { left: 720 }, border: { left: { style: BorderStyle.SINGLE, size: 12, color: "CCCCCC", space: 12 } } }),
      ...listOptions(list),
    };

    switch (node.type.name) {
      case "paragraph":
        return [
          new Paragraph({
            ...base,
            ...this.paragraphMark(node),
            ...(node.attrs.paragraphStyle === "title" && { heading: HeadingLevel.TITLE }),
            ...(node.attrs.paragraphStyle === "subtitle" && { style: SUBTITLE_STYLE }),
            children: await this.headingContent(node),
          }),
        ];
      case "heading":
        return [
          new Paragraph({
            ...base,
            ...this.paragraphMark(node),
            heading: headings[node.attrs.level - 1],
            children: await this.headingContent(node),
          }),
        ];
      case "tableOfContents":
        return this.tableOfContents(node);
      case "blockquote":
        return this.blocks(node, list, true);
      case "bulletList":
        return this.blocks(node, this.nestedList(node, "bullet", list), quoted);
      case "orderedList":
        return this.blocks(node, this.nestedList(node, "ordered", list), quoted);
      case "taskList":
        return this.blocks(node, this.nestedList(node, "task", list), quoted);
      case "listItem":
        return this.listItem(node, list, quoted);
      case "taskItem":
        return this.taskItem(node, list, quoted);
      case "pageBreak":
        return [new Paragraph({ children: [new PageBreak()] })];
      case "codeBlock":
        return [
          new Paragraph({
            ...base,
            shading: { type: ShadingType.CLEAR, fill: "F1F3F4" },
            children: node.textContent
              .split("\n")
              .map((line, index) => new TextRun({ text: line, font: "Courier New", break: index > 0 ? 1 : 0 })),
          }),
        ];
      case "horizontalRule":
        return [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 1 } } })];
      case "image":
        return [new Paragraph({ ...base, children: [await this.image(node)] })];
      case "table":
        return [await this.table(node)];
      default:
        return [new Paragraph({ ...base, children: [new TextRun(node.textContent)] })];
    }
  }

  /** A heading's text, in a bookmark when a table of contents links to it. */
  private async headingContent(node: Node): Promise<ParagraphChild[]> {
    const children = await this.inline(node);
    const index = this.linkedHeadings.get(node);
    return index === undefined ? children : [new Bookmark({ id: headingBookmark(index), children })];
  }

  /**
   * The table of contents as it is shown: static paragraphs, with the page number at a right tab
   * stop (dotted leader for the dotted style), or links to the headings' bookmarks.
   */
  private tableOfContents(toc: Node): Paragraph[] {
    const headingIndex = new Map(tocHeadings(this.doc).map((heading, index) => [heading.pos, index]));
    return children(toc).map((entry, index) => {
      const text = entry.textContent;
      const indent = { left: TWIPS_PER_INDENT * (entry.attrs.indent as number) };
      const target = tocTarget(this.doc, toc, index);
      const bookmark = target ? headingIndex.get(target.pos) : undefined;
      // Entries of the highest level used are bold.
      const bold = entry.attrs.indent === 0 && entry.attrs.heading !== null;
      if (toc.attrs.style === "links") {
        const run = new TextRun({ text, bold, color: "1155CC", underline: {} });
        return new Paragraph({
          indent,
          spacing: { after: 4 * TWIPS_PER_POINT },
          children: [bookmark === undefined ? run : new InternalHyperlink({ anchor: headingBookmark(bookmark), children: [run] })],
        });
      }
      const page = entry.attrs.page === null ? [] : [new TextRun({ children: [new Tab(), String(entry.attrs.page)] })];
      return new Paragraph({
        indent,
        spacing: { after: 4 * TWIPS_PER_POINT },
        tabStops: [
          { type: TabStopType.RIGHT, position: this.contentWidth, ...(toc.attrs.style === "dotted" && { leader: LeaderType.DOT }) },
        ],
        children: [new TextRun({ text, bold }), ...page],
      });
    });
  }

  /** A footnote's text as Word footnote paragraphs; returns the id for its reference. */
  private async footnote(content: RegionContent): Promise<number> {
    const id = ++this.footnoteCount;
    const paragraphs: Paragraph[] = [];
    for (const paragraph of children(regionDoc(content))) {
      paragraphs.push(
        new Paragraph({
          style: "FootnoteText",
          alignment: alignments[paragraph.attrs.textAlign as keyof typeof alignments],
          ...(tabStops(paragraph) && { tabStops: tabStops(paragraph) }),
          children: await this.inline(paragraph),
        }),
      );
    }
    this.footnotes[id] = { children: paragraphs.length > 0 ? paragraphs : [new Paragraph({ style: "FootnoteText" })] };
    return id;
  }

  private nestedList(node: Node, kind: ListKind, parent: ListContext | undefined): ListContext {
    const level = parent ? Math.min(parent.level + 1, LIST_LEVELS - 1) : 0;
    if (parent?.kind === kind) return { ...parent, level };
    return { kind, level, instance: ++this.listCount, preset: listPresetIndex(node.type.name, node.attrs.listPreset) };
  }

  /** Only the first paragraph of an item carries the bullet or number; nested lists need the context for their level. */
  private async listItem(item: Node, list: ListContext | undefined, quoted: boolean): Promise<Block[]> {
    const blocks: Block[] = [];
    for (const [index, child] of children(item).entries()) {
      const isNestedList = ["bulletList", "orderedList", "taskList"].includes(child.type.name);
      blocks.push(...(await this.block(child, index === 0 || isNestedList ? list : undefined, quoted)));
    }
    return blocks;
  }

  /** Word has no checkboxes in plain paragraphs, so checklist items start with ☐ or ☑. */
  private async taskItem(item: Node, list: ListContext | undefined, quoted: boolean): Promise<Block[]> {
    const checked = item.attrs.checked === true;
    const strike = checked && list?.preset === 1;
    const indent = { left: TWIPS_PER_INDENT * ((list?.level ?? 0) + 1), hanging: 360 };
    const blocks: Block[] = [];
    for (const [index, child] of children(item).entries()) {
      if (index === 0 && child.type.name === "paragraph") {
        const runs = await this.inline(child, strike);
        blocks.push(
          new Paragraph({
            alignment: alignments[child.attrs.textAlign as keyof typeof alignments],
            ...this.paragraphMark(child),
            indent,
            ...(tabStops(child) && { tabStops: tabStops(child) }),
            children: [new TextRun({ text: `${checked ? "☑" : "☐"} `, strike: strike || undefined }), ...runs],
          }),
        );
      } else {
        blocks.push(...(await this.block(child, child.type.name === "taskList" ? list : undefined, quoted)));
      }
    }
    return blocks;
  }

  /** Column widths, row heights, cell backgrounds and borders as in the editor; the table fills the content width. */
  private async table(table: Node): Promise<Table> {
    const map = TableMap.get(table);
    const columnWidths = columnFractions(table).map((fraction) => Math.round(fraction * this.contentWidth));
    const rows: TableRow[] = [];
    let offset = 0;
    for (const row of children(table)) {
      const cells: TableCell[] = [];
      let cellOffset = offset + 1;
      for (const cell of children(row)) {
        const content = (await this.blocks(cell)).filter((block): block is Paragraph => block instanceof Paragraph);
        const start = map.colCount(cellOffset);
        const width = columnWidths.slice(start, start + cell.attrs.colspan).reduce((sum, value) => sum + value, 0);
        cells.push(
          new TableCell({
            children: content.length > 0 ? content : [new Paragraph("")],
            columnSpan: cell.attrs.colspan,
            rowSpan: cell.attrs.rowspan,
            width: { size: width, type: WidthType.DXA },
            ...(hexColor(cell.attrs.backgroundColor) && {
              shading: { type: ShadingType.CLEAR, fill: hexColor(cell.attrs.backgroundColor) },
            }),
          }),
        );
        cellOffset += cell.nodeSize;
      }
      const header = row.childCount > 0 && children(row).every((cell) => cell.type.name === "tableHeader");
      rows.push(
        new TableRow({
          children: cells,
          ...(header && { tableHeader: true }),
          ...(isSize(row.attrs.height) && {
            height: { value: Math.round(row.attrs.height * TWIPS_PER_PX), rule: HeightRule.ATLEAST },
          }),
        }),
      );
      offset += row.nodeSize;
    }
    const borderWidth = typeof table.attrs.borderWidth === "number" ? table.attrs.borderWidth : DEFAULT_TABLE_BORDER_WIDTH_PT;
    // Word measures borders in eighths of a point.
    const border =
      borderWidth > 0
        ? {
            style: BorderStyle.SINGLE,
            size: Math.round(borderWidth * 8),
            color: hexColor(table.attrs.borderColor) ?? hexColor(DEFAULT_TABLE_BORDER_COLOR)!,
          }
        : { style: BorderStyle.NONE, size: 0, color: "auto" };
    return new Table({
      rows,
      columnWidths,
      width: { size: this.contentWidth, type: WidthType.DXA },
      layout: TableLayoutType.FIXED,
      borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    });
  }

  /** At the size set in the editor, or the natural size; never wider than the page's content. */
  private async image(node: Node): Promise<ParagraphChild> {
    const data = await this.readImage(node.attrs.src);
    const size = data ? safeImageSize(data) : null;
    if (!data || !size) return new TextRun({ text: `[Image: ${node.attrs.alt || node.attrs.src}]`, italics: true });

    const { width, height } = node.attrs;
    let shown = isSize(width)
      ? { width, height: isSize(height) ? height : (width * size.height) / size.width }
      : { width: size.width, height: size.height };
    const maxWidth = isSize(width) ? this.contentWidth / TWIPS_PER_PX : MAX_IMAGE_WIDTH_PX;
    if (shown.width > maxWidth) shown = { width: maxWidth, height: (shown.height * maxWidth) / shown.width };
    return new ImageRun({
      type: size.type,
      data,
      transformation: { width: Math.round(shown.width), height: Math.round(shown.height) },
      altText: node.attrs.alt ? { name: node.attrs.alt, description: node.attrs.alt, title: node.attrs.alt } : undefined,
    });
  }

  private async inline(parent: Node, strike = false): Promise<ParagraphChild[]> {
    const runs: ParagraphChild[] = [];
    for (const node of children(parent)) {
      if (node.type.name === "hardBreak") {
        runs.push(new TextRun({ text: "", break: 1 }));
      } else if (node.type.name === "tab") {
        runs.push(this.run({ ...runOptions(node.marks, strike), children: [new Tab()] }, node.marks));
      } else if (node.type.name === "image") {
        runs.push(await this.image(node));
      } else if (node.type.name === "pageField") {
        const field = node.attrs.kind === "count" ? PageNumber.TOTAL_PAGES : PageNumber.CURRENT;
        runs.push(this.run({ ...runOptions(node.marks, strike), children: [field] }, node.marks));
      } else if (node.type.name === "footnote") {
        runs.push(new FootnoteReferenceRun(await this.footnote(node.attrs.content as RegionContent)));
      } else if (node.isText) {
        const run = this.run({ text: node.text ?? "", ...runOptions(node.marks, strike) }, node.marks);
        const link = node.marks.find((mark) => mark.type.name === "link");
        runs.push(link ? new ExternalHyperlink({ link: link.attrs.href, children: [run] }) : run);
      }
    }
    return runs;
  }
}

function runOptions(marks: readonly Mark[], strike = false): IRunOptions {
  const has = (name: string) => marks.some((mark) => mark.type.name === name);
  const attr = (name: string, key: string) => marks.find((mark) => mark.type.name === name)?.attrs[key];
  const color = hexColor(attr("textStyle", "color"));
  const fontFamily = attr("textStyle", "fontFamily") as string | undefined;
  const fontSize = halfPoints(attr("textStyle", "fontSize"));
  const highlight = hexColor(attr("highlight", "color") ?? (has("highlight") ? "#FFFF00" : undefined));
  return {
    // Unset rather than false, so the paragraph style (such as Heading 6's italics) applies.
    bold: has("bold") || undefined,
    italics: has("italic") || undefined,
    strike: strike || has("strike") || undefined,
    superScript: has("superscript") || undefined,
    subScript: has("subscript") || undefined,
    underline: has("underline") || has("link") ? {} : undefined,
    font: has("code") ? "Courier New" : fontFamily?.split(",")[0]?.replace(/["']/g, "").trim(),
    size: fontSize,
    color: has("link") ? "1155CC" : color,
    shading: highlight ? { type: ShadingType.CLEAR, fill: highlight } : undefined,
  };
}

function listOptions(list: ListContext | undefined): Partial<IParagraphOptions> {
  if (!list || list.kind === "task") return {};
  const reference = list.kind === "bullet" ? bulletReference(list.preset) : orderedReference(list.preset);
  return { numbering: { reference, level: list.level, instance: list.instance } };
}

/** Left, first line (or hanging) and right indents of a paragraph or heading. */
function indentation(node: Node): IParagraphOptions["indent"] | undefined {
  const { left, firstLine, right } = paragraphIndents(node.attrs);
  const twips = (points: number) => Math.round(points * TWIPS_PER_POINT);
  const result = {
    ...(left !== 0 && { left: twips(left) }),
    ...(right !== 0 && { right: twips(right) }),
    ...(firstLine > 0 && { firstLine: twips(firstLine) }),
    ...(firstLine < 0 && { hanging: twips(-firstLine) }),
  };
  return Object.keys(result).length > 0 ? result : undefined;
}

const tabStopTypes = { left: TabStopType.LEFT, center: TabStopType.CENTER, right: TabStopType.RIGHT } as const;

/** A paragraph's tab stops; both the editor and Word measure them from the left margin. */
function tabStops(node: Node): IParagraphOptions["tabStops"] | undefined {
  const stops = tabStopsOf(node.attrs);
  if (stops.length === 0) return undefined;
  return stops.map((stop) => ({ type: tabStopTypes[stop.kind], position: Math.round(stop.pos * TWIPS_PER_POINT) }));
}

/** Line spacing and the block's own space before and after; the rest comes from its Word style. */
function spacing(node: Node): IParagraphOptions["spacing"] | undefined {
  const { lineSpacing, spaceBefore, spaceAfter } = node.attrs;
  const result = {
    ...(lineSpacing && { line: Math.round(240 * lineSpacing) }),
    ...(typeof spaceBefore === "number" && { before: Math.round(spaceBefore * TWIPS_PER_POINT) }),
    ...(typeof spaceAfter === "number" && { after: Math.round(spaceAfter * TWIPS_PER_POINT) }),
  };
  return Object.keys(result).length > 0 ? result : undefined;
}

function children(node: Node): Node[] {
  const result: Node[] = [];
  node.forEach((child) => result.push(child));
  return result;
}

/** Converts "11pt" or "16px" to Word's half-point font size. */
export function halfPoints(value: unknown): number | undefined {
  const match = typeof value === "string" ? value.trim().match(/^(\d+(?:\.\d+)?)(pt|px)$/) : null;
  if (!match) return undefined;
  const points = match[2] === "px" ? Number(match[1]) * 0.75 : Number(match[1]);
  return Math.round(points * 2);
}

/** Accepts `#rgb`, `#rrggbb` and `rgb(r, g, b)`; returns `RRGGBB` or undefined. */
export function hexColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (hex) return (hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex).toUpperCase();
  const rgb = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgb) return rgb.slice(1, 4).map((part) => Number(part).toString(16).padStart(2, "0")).join("").toUpperCase();
  return undefined;
}

function safeImageSize(data: Buffer): { width: number; height: number; type: "png" | "jpg" | "gif" | "bmp" } | null {
  try {
    const { width, height, type } = imageSize(data);
    const docxType = type === "jpeg" ? "jpg" : type;
    if (!width || !height || !(docxType === "png" || docxType === "jpg" || docxType === "gif" || docxType === "bmp")) return null;
    return { width, height, type: docxType };
  } catch {
    return null;
  }
}
