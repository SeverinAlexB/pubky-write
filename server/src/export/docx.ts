// Converts a document to a Word file with the `docx` library. Suggestions become tracked changes:
// insertions and deletions (w:ins, w:del), text format changes (w:rPrChange), inserted or deleted
// paragraph marks for suggested paragraph breaks, inserted or deleted table rows (w:trPr) and cells
// (w:cellIns, w:cellDel), and inserted or deleted images, breaks and footnote references (their
// runs in w:ins or w:del), also in headers, footers and footnotes.
import {
  AlignmentType,
  Bookmark,
  BorderStyle,
  ColumnBreak,
  CommentRangeEnd,
  CommentRangeStart,
  CommentReference,
  DeletedTableRow,
  DeletedTextRun,
  Document,
  ExternalHyperlink,
  Footer,
  FootnoteReferenceRun,
  Header,
  HeadingLevel,
  ImportedXmlComponent,
  HeightRule,
  HorizontalPositionRelativeFrom,
  ImageRun,
  InsertedTableRow,
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
  TextWrappingSide,
  TextWrappingType,
  VerticalPositionRelativeFrom,
  WidthType,
  type ICommentOptions,
  type IFloating,
  type INumberingOptions,
  type IParagraphOptions,
  type IRunOptions,
  type IStylesOptions,
  type ParagraphChild,
  type XmlComponent,
} from "docx";
import { parseLatex } from "@docs/shared/equations";
import { mathToOmml, type XmlTree } from "../omml.ts";
import { imageSize } from "image-size";
import JSZip from "jszip";
import { Fragment, Mark, type Node } from "@tiptap/pm/model";
import { TableMap } from "@tiptap/pm/tables";
import {
  bulletPresets,
  columnFractions,
  columnsOf,
  columnWidths,
  imageLayoutOf,
  wrapSide,
  type WrapSide,
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
  type CommentThread,
  type MarkJSON,
  type SuggestionMeta,
  type NumberFormat,
  type ParagraphStyleDefinition,
  type RegionContent,
  type RegionKey,
} from "@docs/shared";

export type ImageReader = (src: string) => Promise<Buffer | null>;

type Block = Paragraph | Table;
/** A suggested insertion or deletion that applies to everything inside an object (a deleted table row's text). */
type Tracked = { kind: "insert" | "delete"; meta: SuggestionMeta };

/** The suggested insertion or deletion of a whole object, if any. */
function trackedObject(node: Node): Tracked | null {
  const inserted = node.attrs.suggestionInsert as SuggestionMeta | null | undefined;
  const deleted = node.attrs.suggestionDelete as SuggestionMeta | null | undefined;
  return deleted ? { kind: "delete", meta: deleted } : inserted ? { kind: "insert", meta: inserted } : null;
}
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
/** Word's default left and right cell margin (0.08 in). */
const CELL_MARGIN_TWIPS = 108;

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

/**
 * `comments` are the threads to include, with ranges in `doc`: Word comments on the same text, the
 * replies threaded under the first message and resolved threads marked done.
 */
export async function toDocx(doc: Node, title: string, readImage: ImageReader, comments: readonly CommentThread[] = []): Promise<Buffer> {
  const wordComments = commentDefinitions(comments, doc);
  const converter = new DocxConverter(readImage, contentWidthTwips(doc), doc, wordComments.events);
  const children = await converter.blocks(doc);
  const settings = pageElementsOf(doc);
  const region = async (key: RegionKey, Kind: typeof Header | typeof Footer, always: boolean) => {
    const content = settings[key];
    if (isEmptyRegion(content) && !always) return undefined;
    const blocks = content && !isEmptyRegion(content) ? await converter.blocks(converter.withBreaks(regionDoc(content))) : [];
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
    ...(wordComments.children.length > 0 && { comments: { children: wordComments.children } }),
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
  const buffer = await Packer.toBuffer(file);
  return wordComments.resolvedWithoutReplies ? withResolvedComments(buffer, wordComments.children) : buffer;
}

/** Where a comment's range starts or ends in the document, with the Word comments of its thread. */
type CommentEvent = { pos: number; kind: "start" | "end"; ids: number[] };

/** The Word comments of the threads (each message a comment, replies under the first) and their range events. */
function commentDefinitions(threads: readonly CommentThread[], doc: Node) {
  const children: ICommentOptions[] = [];
  const events: CommentEvent[] = [];
  // Ranges are kept inside the document's text, so every range is written.
  let lastText = 0;
  doc.descendants((node, pos) => {
    if (node.isTextblock) lastText = pos + node.nodeSize - 1;
    return !node.isTextblock;
  });
  const anchored = threads.filter((thread) => thread.to > thread.from && thread.messages.length > 0).sort((a, b) => a.from - b.from);
  for (const thread of anchored) {
    const ids = thread.messages.map((_, index) => children.length + index);
    thread.messages.forEach((message, index) => {
      children.push({
        id: ids[index]!,
        author: COMMENT_AUTHOR,
        initials: COMMENT_AUTHOR.slice(0, 1),
        date: new Date(message.createdAt),
        children: message.body.split("\n").map((line) => new Paragraph(line)),
        ...(index > 0 && { parentId: ids[0] }),
        ...(thread.resolved && { resolved: true }),
      });
    });
    events.push({ pos: Math.min(thread.from, lastText), kind: "start", ids }, { pos: Math.min(thread.to, lastText), kind: "end", ids });
  }
  // Ends before starts at the same position, so touching ranges do not overlap.
  events.sort((a, b) => a.pos - b.pos || (a.kind === b.kind ? 0 : a.kind === "end" ? -1 : 1));
  const resolvedWithoutReplies = anchored.some((thread) => thread.resolved) && !children.some((child) => child.parentId !== undefined);
  // Without replies the library writes no commentsExtended part: durable ids give the comments the
  // paragraph ids withResolvedComments refers to.
  return { children: resolvedWithoutReplies ? children.map((child) => ({ ...child, durableId: paraIdOf(child.id) })) : children, events, resolvedWithoutReplies };
}

/** The comments' author: comments are always by "You" in the editor. */
const COMMENT_AUTHOR = "You";

/** The paragraph id the library gives a comment's last paragraph. */
const paraIdOf = (id: number) => (id + 1).toString(16).toUpperCase().padStart(8, "0");

/** Adds the commentsExtended part that marks resolved comments as done (the library writes it only for replies). */
async function withResolvedComments(buffer: Buffer, comments: readonly ICommentOptions[]): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  const entries = comments.map((comment) => `<w15:commentEx w15:paraId="${paraIdOf(comment.id)}" w15:done="${comment.resolved ? 1 : 0}"/>`);
  zip.file(
    "word/commentsExtended.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w15:commentsEx xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" mc:Ignorable="w15">${entries.join("")}</w15:commentsEx>`,
  );
  const types = await zip.file("[Content_Types].xml")!.async("string");
  zip.file(
    "[Content_Types].xml",
    types.replace(
      "</Types>",
      `<Override PartName="/word/commentsExtended.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml"/></Types>`,
    ),
  );
  const relsPath = "word/_rels/document.xml.rels";
  const rels = await zip.file(relsPath)!.async("string");
  zip.file(
    relsPath,
    rels.replace(
      "</Relationships>",
      `<Relationship Id="rIdCommentsExtended" Type="http://schemas.microsoft.com/office/2011/relationships/commentsExtended" Target="commentsExtended.xml"/></Relationships>`,
    ),
  );
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
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
  const { columns, columnSpacing, columnLine } = columnsOf(doc);
  return {
    // Format > Columns: equal columns, with the space between them and an optional line.
    ...(columns > 1 && { column: { count: columns, space: twips(columnSpacing), separate: columnLine, equalWidth: true } }),
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

  /** The width between the page's margins, in twips (`contentWidth` is a cell's inside tables). */
  private readonly pageContentWidth: number;

  /** Where each of the document's textblocks starts, in document order (a node can occur more than once). */
  private readonly textblockPositions = new Map<Node, number[]>();

  constructor(
    private readonly readImage: ImageReader,
    private contentWidth: number,
    private readonly doc: Node,
    /** Comment range starts and ends, by position; written as they are reached. */
    private readonly commentEvents: CommentEvent[] = [],
  ) {
    this.pageContentWidth = contentWidth;
    if (commentEvents.length > 0) {
      doc.descendants((node, pos) => {
        if (!node.isTextblock) return true;
        this.textblockPositions.set(node, [...(this.textblockPositions.get(node) ?? []), pos]);
        return false;
      });
    }
    let linked = false;
    doc.descendants((node) => {
      if (node.type.name === "tableOfContents" && node.attrs.style === "links") linked = true;
      return !linked && node.isBlock && !node.isTextblock;
    });
    if (linked) tocHeadings(doc).forEach((heading, index) => this.linkedHeadings.set(doc.nodeAt(heading.pos)!, index));
    this.withBreaks(doc);
  }

  /** Records the suggested paragraph breaks of a document (the body, a header, a footnote's text). */
  withBreaks(doc: Node): Node {
    let previous: Node | null = null;
    doc.descendants((node) => {
      if (!node.isTextblock) return true;
      const brk = node.attrs.suggestionBreak as BreakSuggestion | null | undefined;
      if (brk && previous) this.paragraphMarks.set(previous, brk);
      previous = node;
      return false;
    });
    return doc;
  }

  /**
   * The insertion or deletion of the object being converted (a table row, a footnote), which its
   * runs carry too.
   */
  private tracked: Tracked | null = null;

  /** Converts the content of an object with its suggestion applied to all of its runs. */
  private async within<T>(tracked: Tracked | null, convert: () => Promise<T>): Promise<T> {
    if (!tracked || this.tracked) return convert();
    this.tracked = tracked;
    try {
      return await convert();
    } finally {
      this.tracked = null;
    }
  }

  /** The `insertion` or `deletion` option of a run, row, cell or paragraph mark for a tracked object. */
  private revisionOf(tracked: Tracked | null) {
    if (!tracked) return {};
    return tracked.kind === "insert" ? { insertion: this.revision(tracked.meta) } : { deletion: this.revision(tracked.meta) };
  }

  /** A run that is not a text run (a page break, a footnote reference, an equation) inside w:ins or w:del. */
  private trackedRun(tracked: Tracked | null, run: PageBreak | ColumnBreak | FootnoteReferenceRun | XmlComponent): ParagraphChild {
    if (!tracked) return run as ParagraphChild;
    const revision = this.revision(tracked.meta);
    // The library writes these as an empty w:ins / w:del with the revision's attributes.
    const wrapper = tracked.kind === "insert" ? new InsertedTableRow(revision) : new DeletedTableRow(revision);
    wrapper.addChildElement(run);
    return wrapper as unknown as ParagraphChild;
  }

  /** A paragraph of its own for an inserted or deleted object: its paragraph mark goes with it. */
  private objectParagraph(tracked: Tracked | null): Partial<IParagraphOptions> {
    return tracked ? { run: this.revisionOf(tracked) } : {};
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
    const deleted = find("suggestionDelete") ?? (this.tracked?.kind === "delete" ? { attrs: this.tracked.meta } : undefined);
    if (deleted) return new DeletedTextRun({ ...options, ...this.revision(deleted.attrs) });
    const inserted = find("suggestionInsert") ?? (this.tracked?.kind === "insert" ? { attrs: this.tracked.meta } : undefined);
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

  /**
   * Images that are not in line with text are drawings anchored in the paragraph after them (their
   * anchor in the editor too); with no paragraph to follow they get one of their own.
   */
  private anchored: ParagraphChild[] = [];

  async blocks(parent: Node, list?: ListContext, quoted = false): Promise<Block[]> {
    const blocks: Block[] = [];
    const flush = () => {
      if (this.anchored.length > 0) blocks.push(new Paragraph({ children: this.anchored.splice(0) }));
    };
    for (const node of children(parent)) {
      if (node.type.name === "image" && imageLayoutOf(node.attrs).wrap !== "inline") {
        this.anchored.push(await this.image(node));
        continue;
      }
      if (node.type.name !== "paragraph" && node.type.name !== "heading") flush();
      blocks.push(...(await this.block(node, list, quoted)));
    }
    flush();
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
        return this.within(trackedObject(node), async () => this.tableOfContents(node));
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
      case "columnBreak": {
        const tracked = trackedObject(node) ?? this.tracked;
        const brk = node.type.name === "pageBreak" ? new PageBreak() : new ColumnBreak();
        return [new Paragraph({ ...this.objectParagraph(tracked), children: [this.trackedRun(tracked, brk)] })];
      }
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
        return [
          new Paragraph({
            ...this.objectParagraph(trackedObject(node) ?? this.tracked),
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 1 } },
          }),
        ];
      case "image":
        return [new Paragraph({ ...base, ...this.objectParagraph(trackedObject(node) ?? this.tracked), children: [await this.image(node)] })];
      case "table":
        return [await this.within(trackedObject(node), () => this.table(node))];
      default:
        return [new Paragraph({ ...base, children: [new TextRun(node.textContent)] })];
    }
  }

  /** A heading's text, in a bookmark when a table of contents links to it, after the images anchored in it. */
  private async headingContent(node: Node): Promise<ParagraphChild[]> {
    const anchored = this.anchored.splice(0);
    const children = [...anchored, ...(await this.inline(node))];
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
        const run = this.run({ text, bold, color: "1155CC", underline: {} }, []);
        return new Paragraph({
          ...this.objectParagraph(this.tracked),
          indent,
          spacing: { after: 4 * TWIPS_PER_POINT },
          children: [bookmark === undefined ? run : new InternalHyperlink({ anchor: headingBookmark(bookmark), children: [run] })],
        });
      }
      const page = entry.attrs.page === null ? [] : [this.run({ children: [new Tab(), String(entry.attrs.page)] }, [])];
      return new Paragraph({
        ...this.objectParagraph(this.tracked),
        indent,
        spacing: { after: 4 * TWIPS_PER_POINT },
        tabStops: [
          { type: TabStopType.RIGHT, position: this.contentWidth, ...(toc.attrs.style === "dotted" && { leader: LeaderType.DOT }) },
        ],
        children: [this.run({ text, bold }, []), ...page],
      });
    });
  }

  /** A footnote's text as Word footnote paragraphs; returns the id for its reference. */
  private async footnote(content: RegionContent): Promise<number> {
    const id = ++this.footnoteCount;
    const paragraphs: Paragraph[] = [];
    for (const paragraph of children(this.withBreaks(regionDoc(content)))) {
      paragraphs.push(
        new Paragraph({
          style: "FootnoteText",
          ...this.paragraphMark(paragraph),
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
      // A whole inserted or deleted table: every row is.
      const rowTracked = trackedObject(row) ?? this.tracked;
      for (const cell of children(row)) {
        const cellTracked = trackedObject(cell);
        const start = map.colCount(cellOffset);
        const width = columnWidths.slice(start, start + cell.attrs.colspan).reduce((sum, value) => sum + value, 0);
        // A table nested in the cell fills the cell (less Word's default cell margins).
        const pageWidth = this.contentWidth;
        this.contentWidth = Math.max(width - 2 * CELL_MARGIN_TWIPS, TWIPS_PER_INDENT);
        const content = await this.within(rowTracked ?? cellTracked, () => this.blocks(cell)).finally(() => (this.contentWidth = pageWidth));
        // Word needs a paragraph at the end of every cell, also after a table nested in it.
        if (content.at(-1) instanceof Table) content.push(new Paragraph(""));
        cells.push(
          new TableCell({
            children: content.length > 0 ? content : [new Paragraph("")],
            columnSpan: cell.attrs.colspan,
            rowSpan: cell.attrs.rowspan,
            width: { size: width, type: WidthType.DXA },
            // A suggested column: Word's inserted or deleted cells.
            ...(!rowTracked && this.revisionOf(cellTracked)),
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
          ...this.revisionOf(rowTracked),
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

  /**
   * Where text goes beside a wrapped image `width` CSS pixels wide, as in the editor: from its
   * column's width (in a table cell, the cell's).
   */
  private wrapSideOf(node: Node, width: number): WrapSide {
    const content = this.contentWidth / TWIPS_PER_PX;
    const column = this.contentWidth === this.pageContentWidth ? columnWidths(columnsOf(this.doc), content).width : content;
    return wrapSide(imageLayoutOf(node.attrs), width, column);
  }

  /**
   * At the size set in the editor, or the natural size; never wider than the page's content. With
   * its rotation and crop, and anchored with its text wrapping and position when it is not in line.
   */
  private async image(node: Node): Promise<ParagraphChild> {
    const data = await this.readImage(node.attrs.src);
    const size = data ? safeImageSize(data) : null;
    const tracked = trackedObject(node) ?? this.tracked;
    if (!data || !size) return this.within(tracked, async () => this.run({ text: `[Image: ${node.attrs.alt || node.attrs.src}]`, italics: true }, []));

    const layout = imageLayoutOf(node.attrs);
    const { width, height } = node.attrs;
    // A cropped image's stored size is its visible part.
    const visible = layout.crop
      ? { width: size.width * (1 - layout.crop.left - layout.crop.right), height: size.height * (1 - layout.crop.top - layout.crop.bottom) }
      : size;
    let shown = isSize(width)
      ? { width, height: isSize(height) ? height : (width * visible.height) / visible.width }
      : { width: visible.width, height: visible.height };
    const free = layout.wrap === "behind" || layout.wrap === "front";
    const maxWidth = free ? Infinity : isSize(width) ? this.contentWidth / TWIPS_PER_PX : MAX_IMAGE_WIDTH_PX;
    if (shown.width > maxWidth) shown = { width: maxWidth, height: (shown.height * maxWidth) / shown.width };
    const percent = (fraction: number) => Math.round(fraction * 100000) / 1000;
    return new ImageRun({
      type: size.type,
      data,
      transformation: { width: Math.round(shown.width), height: Math.round(shown.height), ...(layout.rotation !== 0 && { rotation: layout.rotation }) },
      ...(layout.crop && {
        crop: { left: percent(layout.crop.left), top: percent(layout.crop.top), right: percent(layout.crop.right), bottom: percent(layout.crop.bottom) },
      }),
      ...(layout.wrap !== "inline" && { floating: floatingOptions(node, this.wrapSideOf(node, shown.width)) }),
      // An inserted or deleted image: its run in w:ins or w:del.
      ...this.revisionOf(tracked),
      altText: node.attrs.alt || node.attrs.title
        ? { name: node.attrs.title || node.attrs.alt, description: node.attrs.alt ?? undefined, title: node.attrs.title ?? undefined }
        : undefined,
    });
  }

  /** The comment range starts and ends up to `pos` not written yet. */
  private commentMarks(pos: number): ParagraphChild[] {
    const result: ParagraphChild[] = [];
    while (this.commentEvents.length > 0 && this.commentEvents[0]!.pos <= pos) {
      const { kind, ids } = this.commentEvents.shift()!;
      for (const id of ids) {
        if (kind === "start") result.push(new CommentRangeStart(id));
        else result.push(new CommentRangeEnd(id), new TextRun({ children: [new CommentReference(id)] }));
      }
    }
    return result;
  }

  /**
   * The runs of a textblock, with the comment ranges in it. Text is split where a range starts or
   * ends; ranges that start or end between textblocks start or end at the next one.
   */
  private async inline(parent: Node, strike = false): Promise<ParagraphChild[]> {
    const start = this.commentEvents.length > 0 ? this.textblockPositions.get(parent)?.shift() : undefined;
    if (start === undefined) return this.inlineRuns(parent, strike);
    const runs: ParagraphChild[] = [...this.commentMarks(start + 1)];
    let pos = start + 1;
    for (const node of children(parent)) {
      if (node.isText) {
        // Split where a comment range starts or ends inside the text.
        let offset = 0;
        while (offset < node.text!.length) {
          const next = this.commentEvents[0]?.pos;
          const end = next !== undefined && next > pos + offset && next < pos + node.text!.length ? next - pos : node.text!.length;
          runs.push(...(await this.inlineRuns(parent.copy(Fragment.from(node.cut(offset, end))), strike)));
          offset = end;
          runs.push(...this.commentMarks(pos + offset));
        }
      } else {
        runs.push(...(await this.inlineRuns(parent.copy(Fragment.from(node)), strike)), ...this.commentMarks(pos + node.nodeSize));
      }
      pos += node.nodeSize;
    }
    return [...runs, ...this.commentMarks(pos)];
  }

  private async inlineRuns(parent: Node, strike = false): Promise<ParagraphChild[]> {
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
        // An inserted or deleted footnote: its reference and its text.
        const mark = node.marks.find((candidate) => candidate.type.name === "suggestionInsert" || candidate.type.name === "suggestionDelete");
        const tracked: Tracked | null = mark
          ? { kind: mark.type.name === "suggestionInsert" ? "insert" : "delete", meta: mark.attrs as SuggestionMeta }
          : this.tracked;
        const id = await this.within(tracked, () => this.footnote(node.attrs.content as RegionContent));
        runs.push(this.trackedRun(tracked, new FootnoteReferenceRun(id)));
      } else if (node.type.name === "equation") {
        // A native Word equation (Office Math); an inserted or deleted one inside w:ins or w:del.
        const mark = node.marks.find((candidate) => candidate.type.name === "suggestionInsert" || candidate.type.name === "suggestionDelete");
        const tracked: Tracked | null = mark
          ? { kind: mark.type.name === "suggestionInsert" ? "insert" : "delete", meta: mark.attrs as SuggestionMeta }
          : this.tracked;
        const latex = node.attrs.latex as string;
        if (latex) runs.push(this.trackedRun(tracked, xmlComponent(mathToOmml(parseLatex(latex)))));
      } else if (node.isText) {
        const run = this.run({ text: node.text ?? "", ...runOptions(node.marks, strike) }, node.marks);
        const link = node.marks.find((mark) => mark.type.name === "link");
        runs.push(link ? new ExternalHyperlink({ link: link.attrs.href, children: [run] }) : run);
      }
    }
    return runs;
  }
}

/** EMUs (Word's drawing unit) in a CSS pixel. */
const EMU_PER_PX = 9525;

/**
 * The anchor of an image that is not in line with text: Wrap text wraps square, on both sides when
 * the editor puts text on both (`side`, from the image's width and its column's) and otherwise on
 * the largest side, Break text tops and bottoms, Behind and In front of text do not wrap. Move with
 * text positions it from the column and paragraph, Fix position on page from the top of the page
 * (and, behind or in front of text, from its left edge).
 */
export function floatingOptions(node: Node, side: WrapSide = "both"): IFloating | undefined {
  const layout = imageLayoutOf(node.attrs);
  if (layout.wrap === "inline") return undefined;
  const emu = (px: number) => Math.round(px * EMU_PER_PX);
  const margin = emu(layout.wrapMargin * (96 / 72));
  const fixed = layout.positioning === "fixed";
  const free = layout.wrap === "behind" || layout.wrap === "front";
  const wrap = {
    wrap: { type: TextWrappingType.SQUARE, side: side === "both" ? TextWrappingSide.BOTH_SIDES : TextWrappingSide.LARGEST },
    break: { type: TextWrappingType.TOP_AND_BOTTOM },
    behind: { type: TextWrappingType.NONE },
    front: { type: TextWrappingType.NONE },
  }[layout.wrap];
  return {
    // Wrapped and breaking images are placed from their column, the others (when fixed) from the page.
    horizontalPosition: {
      relative: fixed && free ? HorizontalPositionRelativeFrom.PAGE : HorizontalPositionRelativeFrom.COLUMN,
      offset: emu(layout.offsetX),
    },
    verticalPosition: {
      relative: fixed ? VerticalPositionRelativeFrom.PAGE : VerticalPositionRelativeFrom.PARAGRAPH,
      offset: emu(layout.offsetY),
    },
    wrap,
    margins: { top: margin, bottom: margin, left: margin, right: margin },
    behindDocument: layout.wrap === "behind",
    allowOverlap: true,
  };
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

/** An element made from an XML tree (Office Math, which the library has no complete model of). */
function xmlComponent(tree: XmlTree): XmlComponent {
  const component = new ImportedXmlComponent(tree.name, tree.attributes);
  for (const child of tree.children ?? []) component.push(typeof child === "string" ? child : xmlComponent(child));
  return component;
}
